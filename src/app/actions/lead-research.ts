"use server"

import { randomUUID } from "node:crypto"
import { and, eq, gte, inArray, sql, sum } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCurrentUser } from "@/lib/crm/queries"
import { db } from "@/lib/db"
import { leadHunterSettings, leadProspectCommunications, leadProspects, leadResearchCandidates, leadResearchRuns } from "@/lib/db/schema"
import { assertPublicResearchUrl, LeadResearchError, parseLeadResearchInput } from "@/lib/lead-research"
import { processLeadResearchCandidateForUser } from "@/lib/lead-research-worker"
import { runLeadHunterSearch } from "@/lib/lead-hunter-search"

const DAY_MS = 24 * 60 * 60 * 1000
const batchSchema = z.object({
  content: z.string().min(1).max(50_000),
  sourceType: z.enum(["company_site", "licensed_directory"]),
  confirmed: z.literal(true),
})
const candidateIdSchema = z.string().uuid()
const draftSchema = z.string().trim().min(1).max(3000)
const outreachDraftsSchema = z.object({
  proposalDraft: draftSchema,
  emailDraft: draftSchema,
  telegramDraft: draftSchema,
})

function validationError() {
  return { ok: false as const, error: "Проверьте URL, тип источника и подтверждение прав на обработку материалов." }
}

async function refreshRunStatus(userId: string, runId: string) {
  const [active] = await db.select({ id: leadResearchCandidates.id })
    .from(leadResearchCandidates)
    .where(and(
      eq(leadResearchCandidates.userId, userId),
      eq(leadResearchCandidates.runId, runId),
      inArray(leadResearchCandidates.status, ["pending", "analyzing", "failed"]),
    ))
    .limit(1)

  if (!active) {
    await db.update(leadResearchRuns)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(leadResearchRuns.id, runId), eq(leadResearchRuns.userId, userId)))
  }
}

export async function createLeadResearchRun(input: unknown) {
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) return validationError()

  const user = await requireCurrentUser()
  let parsedInput: ReturnType<typeof parseLeadResearchInput>
  try {
    parsedInput = parseLeadResearchInput(parsed.data.content)
  } catch (error) {
    return { ok: false as const, error: error instanceof LeadResearchError ? error.message : "Не удалось прочитать список URL." }
  }

  const domains = parsedInput.items.map((item) => item.websiteDomain)
  const [existingLeads, existingCandidates, settings, usageRows] = await Promise.all([
    db.select({ websiteDomain: leadProspects.websiteDomain }).from(leadProspects)
      .where(and(eq(leadProspects.userId, user.id), inArray(leadProspects.websiteDomain, domains))),
    db.select({ websiteDomain: leadResearchCandidates.websiteDomain }).from(leadResearchCandidates)
      .where(and(eq(leadResearchCandidates.userId, user.id), inArray(leadResearchCandidates.websiteDomain, domains))),
    db.select({ dailyTarget: leadHunterSettings.dailyTarget }).from(leadHunterSettings)
      .where(eq(leadHunterSettings.userId, user.id)).limit(1),
    db.select({ total: sum(leadResearchRuns.requestedCount) }).from(leadResearchRuns)
      .where(and(eq(leadResearchRuns.userId, user.id), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS)))),
  ])

  const knownDomains = new Set([
    ...existingLeads.map((row) => row.websiteDomain).filter((domain): domain is string => Boolean(domain)),
    ...existingCandidates.map((row) => row.websiteDomain),
  ])
  const uniqueItems = parsedInput.items.filter((item) => !knownDomains.has(item.websiteDomain))
  const duplicateCount = parsedInput.duplicateCount + parsedInput.items.length - uniqueItems.length
  if (!uniqueItems.length) {
    return { ok: true as const, createdCount: 0, duplicateCount }
  }

  const dailyTarget = settings[0]?.dailyTarget ?? 20
  const usageLast24Hours = Number(usageRows[0]?.total ?? 0)
  const remaining = Math.max(0, dailyTarget - usageLast24Hours)
  if (uniqueItems.length > remaining) {
    return {
      ok: false as const,
      error: `За последние 24 часа можно добавить ещё ${remaining} ${remaining === 1 ? "компанию" : "компаний"} по текущему лимиту ${dailyTarget}. Уменьшите список и повторите попытку.`,
    }
  }

  try {
    for (const item of uniqueItems) await assertPublicResearchUrl(item.url)
  } catch (error) {
    return { ok: false as const, error: error instanceof LeadResearchError ? error.message : "Источник не прошёл проверку безопасности." }
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`)
    const [latestLeads, latestCandidates, latestSettings, latestUsage] = await Promise.all([
      tx.select({ websiteDomain: leadProspects.websiteDomain }).from(leadProspects)
        .where(and(eq(leadProspects.userId, user.id), inArray(leadProspects.websiteDomain, uniqueItems.map((item) => item.websiteDomain)))),
      tx.select({ websiteDomain: leadResearchCandidates.websiteDomain }).from(leadResearchCandidates)
        .where(and(eq(leadResearchCandidates.userId, user.id), inArray(leadResearchCandidates.websiteDomain, uniqueItems.map((item) => item.websiteDomain)))),
      tx.select({ dailyTarget: leadHunterSettings.dailyTarget }).from(leadHunterSettings)
        .where(eq(leadHunterSettings.userId, user.id)).limit(1),
      tx.select({ total: sum(leadResearchRuns.requestedCount) }).from(leadResearchRuns)
        .where(and(eq(leadResearchRuns.userId, user.id), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS)))),
    ])

    const lockedDomains = new Set([
      ...latestLeads.map((row) => row.websiteDomain).filter((domain): domain is string => Boolean(domain)),
      ...latestCandidates.map((row) => row.websiteDomain),
    ])
    const freshItems = uniqueItems.filter((item) => !lockedDomains.has(item.websiteDomain))
    const lockedDuplicateCount = duplicateCount + uniqueItems.length - freshItems.length
    if (!freshItems.length) return { ok: true as const, createdCount: 0, duplicateCount: lockedDuplicateCount }

    const currentTarget = latestSettings[0]?.dailyTarget ?? 20
    const currentUsage = Number(latestUsage[0]?.total ?? 0)
    const available = Math.max(0, currentTarget - currentUsage)
    if (freshItems.length > available) {
      return {
        ok: false as const,
        error: `За последние 24 часа можно добавить ещё ${available} ${available === 1 ? "компанию" : "компаний"} по текущему лимиту ${currentTarget}. Уменьшите список и повторите попытку.`,
      }
    }

    const runId = randomUUID()
    await tx.insert(leadResearchRuns).values({
      id: runId,
      userId: user.id,
      requestedCount: freshItems.length,
      status: "open",
    })

    const inserted = await tx.insert(leadResearchCandidates).values(freshItems.map((item) => ({
      id: randomUUID(),
      userId: user.id,
      runId,
      companyName: item.companyName,
      sourceUrl: item.url,
      websiteDomain: item.websiteDomain,
      sourceType: parsed.data.sourceType,
      status: "pending",
    }))).onConflictDoNothing().returning({ id: leadResearchCandidates.id })

    if (!inserted.length) {
      await tx.delete(leadResearchRuns).where(and(eq(leadResearchRuns.id, runId), eq(leadResearchRuns.userId, user.id)))
      return { ok: true as const, createdCount: 0, duplicateCount: parsedInput.items.length }
    }
    if (inserted.length !== freshItems.length) {
      await tx.update(leadResearchRuns)
        .set({ requestedCount: inserted.length, updatedAt: new Date() })
        .where(and(eq(leadResearchRuns.id, runId), eq(leadResearchRuns.userId, user.id)))
    }
    return {
      ok: true as const,
      createdCount: inserted.length,
      duplicateCount: lockedDuplicateCount + freshItems.length - inserted.length,
    }
  })

  if (result.ok && result.createdCount) revalidatePath("/leads")
  return result
}

export async function analyzeLeadResearchCandidate(candidateId: string) {
  if (!candidateIdSchema.safeParse(candidateId).success) return validationError()
  const user = await requireCurrentUser()
  return processLeadResearchCandidateForUser(user.id, candidateId)
}

export async function startLeadHunterSearch(input: unknown) {
  const user = await requireCurrentUser()
  const parsed = z.object({
    categories: z.array(z.enum(["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"])).min(1).max(6),
    countries: z.array(z.enum(["RU", "KZ", "BY", "AM", "KG", "UZ", "AZ", "MD", "TJ"])).min(1).max(9),
    limit: z.coerce.number().int().min(1).max(50),
  }).safeParse(input)
  if (!parsed.success) return validationError()

  const result = await runLeadHunterSearch(user.id, "manual", parsed.data)
  revalidatePath("/leads")
  return result
}

export async function saveLeadResearchDraft(candidateId: string, input: unknown) {
  if (!candidateIdSchema.safeParse(candidateId).success) return validationError()
  const drafts = outreachDraftsSchema.safeParse(input)
  if (!drafts.success) return validationError()
  const user = await requireCurrentUser()
  const [updated] = await db.update(leadResearchCandidates).set({
    proposalDraft: drafts.data.proposalDraft.trim(),
    emailDraft: drafts.data.emailDraft.trim(),
    telegramDraft: drafts.data.telegramDraft.trim(),
    updatedAt: new Date(),
  }).where(and(
    eq(leadResearchCandidates.id, candidateId),
    eq(leadResearchCandidates.userId, user.id),
    eq(leadResearchCandidates.status, "analyzed"),
  )).returning({ id: leadResearchCandidates.id })

  if (!updated) return { ok: false as const, error: "Сначала завершите AI-анализ карточки." }
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function saveLeadResearchCandidate(candidateId: string, input: unknown) {
  if (!candidateIdSchema.safeParse(candidateId).success) return validationError()
  const drafts = outreachDraftsSchema.safeParse(input)
  if (!drafts.success) return validationError()
  const user = await requireCurrentUser()

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`)
    const [candidate] = await tx.select().from(leadResearchCandidates).where(and(
      eq(leadResearchCandidates.id, candidateId),
      eq(leadResearchCandidates.userId, user.id),
      eq(leadResearchCandidates.status, "analyzed"),
    )).limit(1)
    if (!candidate || candidate.fitScore == null || !candidate.companyName) {
      return { ok: false as const, error: "Карточка ещё не готова к сохранению в Lead Hunter." }
    }

    const [existing] = await tx.select({ id: leadProspects.id }).from(leadProspects).where(and(
      eq(leadProspects.userId, user.id),
      eq(leadProspects.websiteDomain, candidate.websiteDomain),
    )).limit(1)

    let leadProspectId = existing?.id
    if (!leadProspectId) {
      const siteUrl = new URL(candidate.sourceUrl)
      const notes = [
        "AI-анализ и оценки — черновик; перед квалификацией проверьте первоисточник вручную.",
        candidate.summary ? `Кратко: ${candidate.summary}` : "",
        candidate.fitRationale ? `Соответствие: ${candidate.fitRationale}` : "",
        `Потенциал спонсорства: ${candidate.sponsorshipPotential ?? "нет данных"}/100; бартер: ${candidate.barterPotential ?? "нет данных"}/100; денежное: ${candidate.cashPotential ?? "нет данных"}/100; интерес к рекламе: ${candidate.advertisingFit ?? "нет данных"}/100. Это эвристики AI, а не подтверждённый бюджет или намерение.`,
        `Источник: ${candidate.sourceFinalUrl ?? candidate.sourceUrl}`,
      ].filter(Boolean).join("\n").slice(0, 1000)
      const [inserted] = await tx.insert(leadProspects).values({
        id: randomUUID(),
        userId: user.id,
        companyName: candidate.companyName,
        website: `${siteUrl.origin}/`,
        websiteDomain: candidate.websiteDomain,
        industry: candidate.industry,
        region: candidate.region,
        publicEmail: candidate.publicEmail,
        publicPhone: candidate.publicPhone,
        publicInstagramUrl: candidate.instagramUrl,
        sourceUrl: candidate.sourceFinalUrl ?? candidate.sourceUrl,
        sourceType: candidate.sourceType,
        sourceProvider: candidate.sourceProvider,
        searchCategory: candidate.searchCategory,
        searchCountry: candidate.searchCountry,
        status: "new",
        pipelineStage: candidate.fitScore >= 80 ? "priority" : "new",
        potentialScore: candidate.fitScore,
        notes,
      }).onConflictDoNothing().returning({ id: leadProspects.id })
      leadProspectId = inserted?.id
    }

    if (!leadProspectId) {
      const [duplicate] = await tx.select({ id: leadProspects.id }).from(leadProspects).where(and(
        eq(leadProspects.userId, user.id),
        eq(leadProspects.websiteDomain, candidate.websiteDomain),
      )).limit(1)
      leadProspectId = duplicate?.id
    }
    if (!leadProspectId) return { ok: false as const, error: "Не удалось сохранить лид. Обновите страницу и попробуйте снова." }

    await tx.update(leadResearchCandidates).set({
      status: "saved",
      proposalDraft: drafts.data.proposalDraft.trim(),
      emailDraft: drafts.data.emailDraft.trim(),
      telegramDraft: drafts.data.telegramDraft.trim(),
      leadProspectId,
      updatedAt: new Date(),
    }).where(and(eq(leadResearchCandidates.id, candidate.id), eq(leadResearchCandidates.userId, user.id)))

    await tx.insert(leadProspectCommunications).values([
      { id: randomUUID(), userId: user.id, leadProspectId, channel: "email", status: "draft", body: drafts.data.emailDraft.trim() },
      { id: randomUUID(), userId: user.id, leadProspectId, channel: "telegram", status: "draft", body: drafts.data.telegramDraft.trim() },
    ])

    return { ok: true as const, reused: Boolean(existing), runId: candidate.runId }
  })

  if (result.ok) {
    await refreshRunStatus(user.id, result.runId)
    revalidatePath("/leads")
  }
  return result.ok ? { ok: true as const, reused: result.reused } : result
}

export async function rejectLeadResearchCandidate(candidateId: string) {
  if (!candidateIdSchema.safeParse(candidateId).success) return validationError()
  const user = await requireCurrentUser()
  const [updated] = await db.update(leadResearchCandidates).set({
    status: "rejected",
    updatedAt: new Date(),
  }).where(and(
    eq(leadResearchCandidates.id, candidateId),
    eq(leadResearchCandidates.userId, user.id),
    inArray(leadResearchCandidates.status, ["pending", "failed", "analyzed"]),
  )).returning({ runId: leadResearchCandidates.runId })

  if (!updated) return { ok: false as const, error: "Карточка не найдена или уже закрыта." }
  await refreshRunStatus(user.id, updated.runId)
  revalidatePath("/leads")
  return { ok: true as const }
}

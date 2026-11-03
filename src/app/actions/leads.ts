"use server"

import { randomUUID } from "node:crypto"
import { and, eq, or } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { companies, leadHunterSettings, leadProspectCommunications, leadProspects } from "@/lib/db/schema"

const httpUrl = z.string().trim().url().max(2048).refine((value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, "Укажите ссылку с http:// или https://")
const optionalUrl = z.union([z.literal(""), httpUrl]).optional()
const optionalEmail = z.union([z.literal(""), z.string().trim().email().max(254)]).optional()

const leadSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  website: optionalUrl,
  industry: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  searchCategory: z.union([z.literal(""), z.enum(["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"])]).optional(),
  searchCountry: z.union([z.literal(""), z.enum(["RU", "KZ", "BY", "AM", "KG", "UZ", "AZ", "MD", "TJ"])]).optional(),
  publicEmail: optionalEmail,
  publicPhone: z.string().trim().max(40).optional(),
  publicTelegramUrl: optionalUrl,
  publicInstagramUrl: optionalUrl,
  sourceUrl: httpUrl,
  sourceType: z.enum(["company_site", "licensed_directory"]),
  potentialScore: z.coerce.number().int().min(0).max(100),
  notes: z.string().trim().max(1000).optional(),
  verified: z.literal("on").optional(),
})
const statusSchema = z.enum(["new", "verified", "qualified", "rejected"])
const pipelineStageSchema = z.enum(["new", "analyzed", "priority", "proposal_prepared", "sent", "replied", "negotiating", "partnered", "refused"])
const scoreSchema = z.coerce.number().int().min(0).max(100)
const targetSchema = z.coerce.number().int().min(20).max(50)

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

function normalizeWebsite(value?: string) {
  if (!value) return { website: null, domain: null }
  const url = new URL(value)
  return {
    website: `${url.origin}/`,
    domain: url.hostname.toLowerCase().replace(/^www\./, ""),
  }
}

function normalizeDomain(value?: string | null) {
  if (!value) return null
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return value.trim().toLowerCase().replace(/^www\./, "")
  }
}

function inputError() {
  return { ok: false as const, error: "Проверьте заполненные поля и ссылки на первоисточники." }
}

function duplicateError() {
  return { ok: false as const, error: "Компания с таким сайтом уже есть в Lead Hunter. Откройте существующую карточку." }
}

export async function createLeadProspect(input: unknown) {
  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) return inputError()

  const userId = await getUserId()
  const website = normalizeWebsite(parsed.data.website || undefined)
  if (website.domain) {
    const [duplicate] = await db.select({ id: leadProspects.id }).from(leadProspects)
      .where(and(eq(leadProspects.userId, userId), eq(leadProspects.websiteDomain, website.domain))).limit(1)
    if (duplicate) return duplicateError()
  }
  if (parsed.data.publicTelegramUrl || parsed.data.publicInstagramUrl) {
    const links = [
      ...(parsed.data.publicTelegramUrl ? [eq(leadProspects.publicTelegramUrl, parsed.data.publicTelegramUrl)] : []),
      ...(parsed.data.publicInstagramUrl ? [eq(leadProspects.publicInstagramUrl, parsed.data.publicInstagramUrl)] : []),
    ]
    const [duplicate] = await db.select({ id: leadProspects.id }).from(leadProspects)
      .where(and(eq(leadProspects.userId, userId), or(...links))).limit(1)
    if (duplicate) return duplicateError()
  }

  const verifiedAt = parsed.data.verified ? new Date() : null
  try {
    await db.insert(leadProspects).values({
      id: randomUUID(),
      userId,
      companyName: parsed.data.companyName,
      website: website.website,
      websiteDomain: website.domain,
      industry: parsed.data.industry || null,
      region: parsed.data.region || null,
      searchCategory: parsed.data.searchCategory || null,
      searchCountry: parsed.data.searchCountry || null,
      publicEmail: parsed.data.publicEmail || null,
      publicPhone: parsed.data.publicPhone || null,
      publicTelegramUrl: parsed.data.publicTelegramUrl || null,
      publicInstagramUrl: parsed.data.publicInstagramUrl || null,
      sourceUrl: new URL(parsed.data.sourceUrl).toString(),
      pipelineStage: parsed.data.potentialScore >= 80 ? "priority" : "new",
      sourceType: parsed.data.sourceType,
      status: verifiedAt ? "verified" : "new",
      potentialScore: parsed.data.potentialScore,
      notes: parsed.data.notes || null,
      verifiedAt,
    })
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return duplicateError()
    throw error
  }

  revalidatePath("/leads")
  return { ok: true as const }
}

export async function updateLeadStatus(id: string, status: string) {
  const parsedId = z.string().uuid().safeParse(id)
  const parsedStatus = statusSchema.safeParse(status)
  if (!parsedId.success || !parsedStatus.success) return inputError()

  const userId = await getUserId()
  const [lead] = await db.select({ status: leadProspects.status, verifiedAt: leadProspects.verifiedAt, potentialScore: leadProspects.potentialScore })
    .from(leadProspects).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId))).limit(1)
  if (!lead) return { ok: false as const, error: "Карточка лида не найдена." }
  if (lead.status === "converted") return { ok: false as const, error: "Компания уже добавлена в CRM." }
  if (parsedStatus.data === "qualified" && !["verified", "qualified"].includes(lead.status)) {
    return { ok: false as const, error: "Сначала откройте и проверьте первоисточник." }
  }

  const pipelineStage = parsedStatus.data === "new" ? "new"
    : parsedStatus.data === "verified" ? "analyzed"
      : parsedStatus.data === "qualified" ? lead.potentialScore >= 80 ? "priority" : "proposal_prepared"
        : "refused"
  await db.update(leadProspects).set({
    status: parsedStatus.data,
    pipelineStage,
    verifiedAt: parsedStatus.data === "new" ? null : ["verified", "qualified"].includes(parsedStatus.data) ? lead.verifiedAt ?? new Date() : lead.verifiedAt,
    updatedAt: new Date(),
  }).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function updateLeadScore(id: string, score: unknown) {
  const parsedId = z.string().uuid().safeParse(id)
  const parsedScore = scoreSchema.safeParse(score)
  if (!parsedId.success || !parsedScore.success) return inputError()

  const userId = await getUserId()
  await db.update(leadProspects).set({ potentialScore: parsedScore.data, updatedAt: new Date() })
    .where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function saveLeadHunterTarget(value: unknown) {
  const parsedTarget = targetSchema.safeParse(value)
  if (!parsedTarget.success) return inputError()

  const userId = await getUserId()
  await db.insert(leadHunterSettings).values({
    id: randomUUID(), userId, dailyTarget: parsedTarget.data,
  }).onConflictDoUpdate({
    target: leadHunterSettings.userId,
    set: { dailyTarget: parsedTarget.data, updatedAt: new Date() },
  })
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function saveLeadHunterPreferences(input: unknown) {
  const parsed = z.object({
    dailySearchEnabled: z.boolean(),
    searchCountries: z.array(z.enum(["RU", "KZ", "BY", "AM", "KG", "UZ", "AZ", "MD", "TJ"])).min(1).max(9),
    searchCategories: z.array(z.enum(["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"])).min(1).max(6),
  }).safeParse(input)
  if (!parsed.success) return inputError()

  const userId = await getUserId()
  await db.insert(leadHunterSettings).values({
    id: randomUUID(), userId,
    dailySearchEnabled: parsed.data.dailySearchEnabled,
    searchCountries: [...new Set(parsed.data.searchCountries)],
    searchCategories: [...new Set(parsed.data.searchCategories)],
  }).onConflictDoUpdate({
    target: leadHunterSettings.userId,
    set: {
      dailySearchEnabled: parsed.data.dailySearchEnabled,
      searchCountries: [...new Set(parsed.data.searchCountries)],
      searchCategories: [...new Set(parsed.data.searchCategories)],
      updatedAt: new Date(),
    },
  })
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function updateLeadPipelineStage(id: string, stage: string) {
  const parsedId = z.string().uuid().safeParse(id)
  const parsedStage = pipelineStageSchema.safeParse(stage)
  if (!parsedId.success || !parsedStage.success) return inputError()

  const userId = await getUserId()
  const [lead] = await db.select({ status: leadProspects.status })
    .from(leadProspects).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId))).limit(1)
  if (!lead) return { ok: false as const, error: "Карточка лида не найдена." }
  if (parsedStage.data === "partnered" && lead.status !== "converted") {
    return { ok: false as const, error: "Сначала добавьте проверенную компанию в CRM." }
  }
  if (["analyzed", "priority", "proposal_prepared", "sent", "replied", "negotiating"].includes(parsedStage.data) && !["verified", "qualified", "converted"].includes(lead.status)) {
    return { ok: false as const, error: "Сначала откройте первоисточник и подтвердите компанию." }
  }
  if (lead.status === "converted" && parsedStage.data !== "partnered") {
    return { ok: false as const, error: "Статус партнёра в CRM нельзя изменить этим действием." }
  }

  const status = parsedStage.data === "new" ? "new"
    : parsedStage.data === "analyzed" ? "verified"
      : parsedStage.data === "priority" ? "qualified"
        : parsedStage.data === "refused" ? "rejected"
          : parsedStage.data === "partnered" ? "converted"
            : lead.status
  await db.update(leadProspects).set({
    pipelineStage: parsedStage.data,
    status,
    verifiedAt: parsedStage.data === "new" ? null : undefined,
    updatedAt: new Date(),
  }).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function createLeadCommunication(input: unknown) {
  const parsed = z.object({
    leadId: z.string().uuid(),
    channel: z.enum(["email", "telegram"]),
    status: z.enum(["draft", "sent", "received"]),
    body: z.string().trim().min(1).max(5000),
  }).safeParse(input)
  if (!parsed.success) return inputError()

  const userId = await getUserId()
  const [lead] = await db.select({ id: leadProspects.id, status: leadProspects.status, pipelineStage: leadProspects.pipelineStage })
    .from(leadProspects)
    .where(and(eq(leadProspects.id, parsed.data.leadId), eq(leadProspects.userId, userId)))
    .limit(1)
  if (!lead) return { ok: false as const, error: "Карточка лида не найдена." }
  if (lead.pipelineStage === "partnered") return { ok: false as const, error: "Историю действующего партнёра изменяйте в карточке компании." }

  await db.insert(leadProspectCommunications).values({
    id: randomUUID(),
    userId,
    leadProspectId: lead.id,
    channel: parsed.data.channel,
    status: parsed.data.status,
    body: parsed.data.body,
  })
  if (parsed.data.status === "sent" || parsed.data.status === "received") {
    await db.update(leadProspects).set({
      pipelineStage: parsed.data.status === "sent" ? "sent" : "replied",
      updatedAt: new Date(),
    }).where(and(eq(leadProspects.id, lead.id), eq(leadProspects.userId, userId)))
  }
  revalidatePath("/leads")
  return { ok: true as const }
}

export async function convertLeadToCompany(id: string) {
  if (!z.string().uuid().safeParse(id).success) return inputError()
  const userId = await getUserId()

  const result = await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leadProspects)
      .where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId))).limit(1)
    if (!lead) return { ok: false as const, error: "Карточка лида не найдена." }
    if (lead.status === "converted" && lead.companyId) {
      return { ok: true as const, companyId: lead.companyId, reused: true }
    }
    if (!["verified", "qualified"].includes(lead.status)) {
      return { ok: false as const, error: "Перед добавлением в CRM проверьте первоисточник." }
    }

    const ownedCompanies = await tx.select({ id: companies.id, domain: companies.domain }).from(companies)
      .where(eq(companies.userId, userId))
    const existing = lead.websiteDomain
      ? ownedCompanies.find((company) => normalizeDomain(company.domain) === lead.websiteDomain)
      : undefined
    const companyId = existing?.id ?? randomUUID()

    if (!existing) {
      await tx.insert(companies).values({
        id: companyId,
        userId,
        name: lead.companyName,
        domain: lead.websiteDomain ?? lead.website,
        industry: lead.industry,
        notes: `Добавлена из Lead Hunter. Первоисточник: ${lead.sourceUrl}`,
      })
    }

    await tx.update(leadProspects).set({
      status: "converted", pipelineStage: "partnered", companyId, updatedAt: new Date(),
    }).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))

    return { ok: true as const, companyId, reused: Boolean(existing) }
  })

  if (result.ok) {
    revalidatePath("/leads")
    revalidatePath("/companies")
    revalidatePath("/dashboard")
  }
  return result
}

export async function deleteLeadProspect(id: string) {
  if (!z.string().uuid().safeParse(id).success) return inputError()
  const userId = await getUserId()
  await db.transaction(async (tx) => {
    await tx.delete(leadProspectCommunications).where(and(
      eq(leadProspectCommunications.leadProspectId, id),
      eq(leadProspectCommunications.userId, userId),
    ))
    await tx.delete(leadProspects).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))
  })
  revalidatePath("/leads")
  return { ok: true as const }
}

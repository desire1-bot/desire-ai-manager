import { and, eq, inArray, lt, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/lib/db"
import { leadResearchCandidates, leadResearchRuns } from "@/lib/db/schema"
import { analyzeCompanySource, fetchCompanySiteSource, isTelegramHost, LeadResearchError, type LeadResearchSourceSnapshot } from "@/lib/lead-research"

const candidateIdSchema = z.string().uuid()

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

export async function processLeadResearchCandidateForUser(userId: string, candidateId: string) {
  if (!candidateIdSchema.safeParse(candidateId).success) {
    return { ok: false as const, error: "Проверьте идентификатор карточки." }
  }

  const staleBefore = new Date(Date.now() - 15 * 60 * 1000)
  const [candidate] = await db.update(leadResearchCandidates)
    .set({ status: "analyzing", errorMessage: null, retryable: false, updatedAt: new Date() })
    .where(and(
      eq(leadResearchCandidates.id, candidateId),
      eq(leadResearchCandidates.userId, userId),
      or(
        eq(leadResearchCandidates.status, "pending"),
        and(eq(leadResearchCandidates.status, "failed"), eq(leadResearchCandidates.retryable, true)),
        and(eq(leadResearchCandidates.status, "analyzing"), lt(leadResearchCandidates.updatedAt, staleBefore)),
      ),
    ))
    .returning({
      id: leadResearchCandidates.id,
      runId: leadResearchCandidates.runId,
      sourceUrl: leadResearchCandidates.sourceUrl,
      websiteDomain: leadResearchCandidates.websiteDomain,
      companyName: leadResearchCandidates.companyName,
      sourceTitle: leadResearchCandidates.sourceTitle,
      sourceRetrievedAt: leadResearchCandidates.sourceRetrievedAt,
      sourceSnapshot: leadResearchCandidates.sourceSnapshot,
      sourceFinalUrl: leadResearchCandidates.sourceFinalUrl,
      sourceCheckStatus: leadResearchCandidates.sourceCheckStatus,
      sourceCheckResults: leadResearchCandidates.sourceCheckResults,
      retryCount: leadResearchCandidates.retryCount,
      publicEmail: leadResearchCandidates.publicEmail,
      publicPhone: leadResearchCandidates.publicPhone,
    })

  if (!candidate) {
    const [existing] = await db.select({ status: leadResearchCandidates.status, retryable: leadResearchCandidates.retryable })
      .from(leadResearchCandidates)
      .where(and(eq(leadResearchCandidates.id, candidateId), eq(leadResearchCandidates.userId, userId)))
      .limit(1)
    if (!existing) return { ok: false as const, error: "Карточка исследования не найдена." }
    if (existing.status === "failed" && !existing.retryable) {
      return { ok: false as const, error: "Эта ошибка не исправится повторным запросом. Проверьте URL и правила доступа источника." }
    }
    return { ok: false as const, error: "Эта карточка уже обрабатывается или не ожидает анализа." }
  }

  try {
    if (isTelegramHost(new URL(candidate.sourceUrl).hostname)) {
      throw new LeadResearchError("AI-анализ Telegram-источников отключён. Сохранена только ссылка на публичный канал.")
    }
    const cachedSource: LeadResearchSourceSnapshot | null = candidate.sourceSnapshot && candidate.sourceFinalUrl && candidate.sourceRetrievedAt && candidate.sourceCheckStatus === "passed"
      ? {
          sourceSnapshot: candidate.sourceSnapshot,
          sourceFinalUrl: candidate.sourceFinalUrl,
          sourceRetrievedAt: candidate.sourceRetrievedAt,
          sourceTitle: candidate.sourceTitle,
          sourceCheckResults: candidate.sourceCheckResults,
          publicEmail: candidate.publicEmail,
          publicPhone: candidate.publicPhone,
        }
      : null
    const source = cachedSource ?? await fetchCompanySiteSource({
      sourceUrl: candidate.sourceUrl,
      websiteDomain: candidate.websiteDomain,
    })

    if (!cachedSource) {
      await db.update(leadResearchCandidates).set({
        sourceTitle: source.sourceTitle,
        sourceRetrievedAt: source.sourceRetrievedAt,
        sourceSnapshot: source.sourceSnapshot,
        sourceFinalUrl: source.sourceFinalUrl,
        sourceCheckStatus: "passed",
        sourceCheckResults: source.sourceCheckResults,
        publicEmail: source.publicEmail,
        publicPhone: source.publicPhone,
        updatedAt: new Date(),
      }).where(and(
        eq(leadResearchCandidates.id, candidate.id),
        eq(leadResearchCandidates.userId, userId),
        eq(leadResearchCandidates.status, "analyzing"),
      ))
    }

    const analysis = await analyzeCompanySource({
      sourceUrl: source.sourceFinalUrl,
      sourceTitle: source.sourceTitle,
      sourceRetrievedAt: source.sourceRetrievedAt,
      sourceSnapshot: source.sourceSnapshot,
      companyName: candidate.companyName,
      retryCount: candidate.retryCount,
      onRetry: async (retryCount) => {
        await db.update(leadResearchCandidates).set({ retryCount, updatedAt: new Date() }).where(and(
          eq(leadResearchCandidates.id, candidate.id),
          eq(leadResearchCandidates.userId, userId),
          eq(leadResearchCandidates.status, "analyzing"),
        ))
      },
    })

    await db.update(leadResearchCandidates).set({
      companyName: analysis.companyName,
      sourceTitle: analysis.sourceTitle,
      sourceRetrievedAt: analysis.sourceRetrievedAt,
      sourceFinalUrl: source.sourceFinalUrl,
      sourceSnapshot: source.sourceSnapshot,
      sourceCheckStatus: "passed",
      sourceCheckResults: source.sourceCheckResults,
      publicEmail: source.publicEmail,
      publicPhone: source.publicPhone,
      summary: analysis.summary,
      industry: analysis.industry,
      region: analysis.region,
      fitScore: analysis.fitScore,
      sponsorshipPotential: analysis.sponsorshipPotential,
      barterPotential: analysis.barterPotential,
      cashPotential: analysis.cashPotential,
      advertisingFit: analysis.advertisingFit,
      geographicCoverage: analysis.geographicCoverage,
      fitRationale: analysis.fitRationale,
      evidence: analysis.evidence,
      proposalDraft: analysis.proposalDraft,
      emailDraft: analysis.emailDraft,
      telegramDraft: analysis.telegramDraft,
      status: "analyzed",
      errorMessage: null,
      retryable: false,
      retryCount: analysis.retryCount,
      modelId: analysis.modelId,
      analyzedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(leadResearchCandidates.id, candidate.id), eq(leadResearchCandidates.userId, userId)))

    await refreshRunStatus(userId, candidate.runId)
    revalidatePath("/leads")
    return { ok: true as const }
  } catch (error) {
    const researchError = error instanceof LeadResearchError ? error : null
    const message = researchError?.message ?? "Не удалось завершить анализ. Карточка осталась в очереди; платный резервный маршрут не используется."
    const retryable = researchError?.retryable ?? false
    const isSourceFailure = researchError?.stage === "source"
    const sourceCheckStatus = isSourceFailure
      ? retryable ? "temporary_error" as const : "blocked" as const
      : candidate.sourceCheckStatus
    const sourceCheckResults = isSourceFailure
      ? { ...candidate.sourceCheckResults, checkedAt: new Date().toISOString(), error: message.slice(0, 500) }
      : candidate.sourceCheckResults

    await db.update(leadResearchCandidates).set({
      status: "failed",
      errorMessage: message.slice(0, 500),
      retryable,
      retryCount: researchError?.retryCount ?? candidate.retryCount,
      sourceCheckStatus,
      sourceCheckResults,
      updatedAt: new Date(),
    }).where(and(eq(leadResearchCandidates.id, candidate.id), eq(leadResearchCandidates.userId, userId)))
    revalidatePath("/leads")
    return { ok: false as const, error: message }
  }
}

export async function processQueuedLeadResearch(userId: string, limit: number) {
  const candidates = await db.select({ id: leadResearchCandidates.id })
    .from(leadResearchCandidates)
    .where(and(
      eq(leadResearchCandidates.userId, userId),
      or(
        eq(leadResearchCandidates.status, "pending"),
        and(eq(leadResearchCandidates.status, "failed"), eq(leadResearchCandidates.retryable, true)),
      ),
    ))
    .orderBy(leadResearchCandidates.createdAt)
    .limit(limit)

  let cursor = 0
  const worker = async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor]
      cursor += 1
      await processLeadResearchCandidateForUser(userId, candidate.id)
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()))
  return candidates.length
}

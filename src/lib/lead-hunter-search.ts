import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, inArray, or, sql, sum } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  leadHunterSearchRuns,
  leadHunterSettings,
  leadProspects,
  leadResearchCandidates,
  leadResearchRuns,
} from "@/lib/db/schema"
import { assertPublicResearchUrl, normalizeResearchUrl } from "@/lib/lead-research"
import { processQueuedLeadResearch } from "@/lib/lead-research-worker"
import type { LeadHunterCategory, LeadHunterCountry, LeadSearchTrigger } from "@/lib/lead-research-types"
import { leadHunterCategories, leadHunterCountries } from "@/lib/lead-hunter-options"

const MAX_QUERIES_PER_RUN = 10
const RESULTS_PER_QUERY = 20
const MAX_SCHEDULED_USERS_PER_RUN = 10
const DAY_MS = 24 * 60 * 60 * 1000

const defaultCategories: LeadHunterCategory[] = ["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"]
const defaultCountries: LeadHunterCountry[] = ["RU"]
const socialOnlyNote = "Сохранена только публичная ссылка из Brave Search. Посты, публикации и контакты из соцсети не загружались и не передавались AI. Добавьте официальный сайт компании для AI-анализа."

type BraveResult = { title?: unknown; url?: unknown; description?: unknown }
type NormalizedSocialLink = { platform: "telegram" | "instagram"; url: string; label: string }

function cleanResultText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return ""
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function normalizeSocialLink(value: string): NormalizedSocialLink | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password || url.port) return null

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "")
  const segments = url.pathname.split("/").filter(Boolean)
  if (["t.me", "telegram.me"].includes(hostname)) {
    const slug = segments[0] === "s" ? segments[1] : segments[0]
    if (!slug || slug.startsWith("+") || !/^[a-z0-9_]{5,64}$/i.test(slug)) return null
    if (["joinchat", "share", "login", "proxy", "addstickers", "addemoji", "c"].includes(slug.toLowerCase())) return null
    return { platform: "telegram", url: `https://t.me/${slug}`, label: slug.replace(/_/g, " ") }
  }
  if (hostname === "instagram.com" || hostname === "m.instagram.com") {
    const slug = segments[0]
    if (!slug || !/^[a-z0-9._]{1,30}$/i.test(slug)) return null
    if (["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about"].includes(slug.toLowerCase())) return null
    return { platform: "instagram", url: `https://www.instagram.com/${slug}/`, label: slug.replace(/[._]/g, " ") }
  }
  return null
}

function buildQuery(category: LeadHunterCategory, country: LeadHunterCountry) {
  const categoryQuery = leadHunterCategories.find((item) => item.id === category)?.query
  const countryLabel = leadHunterCountries.find((item) => item.id === country)?.label
  if (!categoryQuery || !countryLabel) throw new Error("Неподдерживаемая категория или страна.")
  return `${categoryQuery} ${countryLabel} контакты реклама партнёрство`
}

function rotateCombinations(categories: LeadHunterCategory[], countries: LeadHunterCountry[], day: string) {
  const combinations = categories.flatMap((category) => countries.map((country) => ({ category, country })))
  const dayNumber = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / DAY_MS)
  const start = combinations.length ? dayNumber % combinations.length : 0
  return Array.from({ length: Math.min(MAX_QUERIES_PER_RUN, combinations.length) }, (_, index) => combinations[(start + index) % combinations.length])
}

async function searchBrave(query: string, country: LeadHunterCountry): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY не настроен в окружении приложения.")

  const url = new URL("https://api.search.brave.com/res/v1/web/search")
  url.searchParams.set("q", query)
  url.searchParams.set("country", country)
  url.searchParams.set("search_lang", "ru")
  url.searchParams.set("count", String(RESULTS_PER_QUERY))
  url.searchParams.set("safesearch", "moderate")

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new Error("Brave Search временно недоступен. Запуск сохранён в истории; можно повторить вручную.")
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    const message = retryable
      ? "Brave Search временно ограничил запрос или недоступен. Повторите поиск позже."
      : response.status === 401 || response.status === 403
        ? "Brave Search отклонил ключ или текущий тариф. Проверьте доступ к Search API и Storage Rights."
        : `Brave Search вернул HTTP ${response.status}.`
    throw new Error(message)
  }

  const payload = await response.json() as { web?: { results?: unknown } }
  return Array.isArray(payload.web?.results) ? payload.web.results as BraveResult[] : []
}

function serializeCandidate(result: BraveResult, query: string, category: LeadHunterCategory, country: LeadHunterCountry) {
  if (typeof result.url !== "string") return null
  const socialLink = normalizeSocialLink(result.url)
  if (socialLink) {
    return {
      kind: "social" as const,
      url: socialLink.url,
      platform: socialLink.platform,
      label: socialLink.label,
      query,
      category,
      country,
    }
  }

  const title = cleanResultText(result.title, 180)
  if (!title) return null
  try {
    const normalized = normalizeResearchUrl(result.url)
    return {
      kind: "website" as const,
      url: normalized.url,
      websiteDomain: normalized.websiteDomain,
      companyName: title.slice(0, 160),
      title: title.slice(0, 200),
      description: cleanResultText(result.description, 700),
      query,
      category,
      country,
    }
  } catch {
    return null
  }
}

async function validateWebsiteCandidates<T extends { kind: "website"; url: string }>(items: T[]) {
  const results: T[] = []
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      try {
        await assertPublicResearchUrl(item.url)
        results.push(item)
      } catch {
        // Unsafe, blocked, or unresolvable result URLs are ignored before persistence.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, () => worker()))
  return results
}

async function persistSearchResults(input: {
  userId: string
  searchRunId: string
  query: string
  category: LeadHunterCategory
  country: LeadHunterCountry
  candidates: ReturnType<typeof serializeCandidate>[]
  remaining: number
}) {
  const items = input.candidates.filter((item): item is NonNullable<typeof item> => item !== null)
  const websiteCandidates = await validateWebsiteCandidates(items.filter((item): item is Extract<NonNullable<typeof item>, { kind: "website" }> => item.kind === "website"))
  const socialCandidates = items.filter((item): item is Extract<NonNullable<typeof item>, { kind: "social" }> => item.kind === "social")

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`)
    const usageRows = await tx.select({ total: sum(leadResearchRuns.requestedCount) })
      .from(leadResearchRuns)
      .where(and(eq(leadResearchRuns.userId, input.userId), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS))))
    const [settings] = await tx.select({ dailyTarget: leadHunterSettings.dailyTarget }).from(leadHunterSettings)
      .where(eq(leadHunterSettings.userId, input.userId)).limit(1)
    const usage = Number(usageRows[0]?.total ?? 0)
    const available = Math.max(0, Math.min(input.remaining, (settings?.dailyTarget ?? 20) - usage))

    const queriedDomains = [...new Set(websiteCandidates.map((item) => item.websiteDomain))]
    const [existingLeads, existingCandidates] = queriedDomains.length ? await Promise.all([
      tx.select({ websiteDomain: leadProspects.websiteDomain }).from(leadProspects).where(and(
        eq(leadProspects.userId, input.userId), inArray(leadProspects.websiteDomain, queriedDomains),
      )),
      tx.select({ websiteDomain: leadResearchCandidates.websiteDomain }).from(leadResearchCandidates).where(and(
        eq(leadResearchCandidates.userId, input.userId), inArray(leadResearchCandidates.websiteDomain, queriedDomains),
      )),
    ]) : [[], []]
    const knownDomains = new Set([
      ...existingLeads.map((lead) => lead.websiteDomain).filter((domain): domain is string => Boolean(domain)),
      ...existingCandidates.map((candidate) => candidate.websiteDomain),
    ])
    const freshDomains = new Set<string>()
    const freshWebsites = websiteCandidates.filter((item) => {
      if (knownDomains.has(item.websiteDomain) || freshDomains.has(item.websiteDomain)) return false
      freshDomains.add(item.websiteDomain)
      return true
    })

    const telegramUrls = [...new Set(socialCandidates.filter((item) => item.platform === "telegram").map((item) => item.url))]
    const instagramUrls = [...new Set(socialCandidates.filter((item) => item.platform === "instagram").map((item) => item.url))]
    const existingSocialLinks = telegramUrls.length || instagramUrls.length
      ? await tx.select({ telegram: leadProspects.publicTelegramUrl, instagram: leadProspects.publicInstagramUrl })
        .from(leadProspects)
        .where(and(
          eq(leadProspects.userId, input.userId),
          or(
            ...(telegramUrls.length ? [inArray(leadProspects.publicTelegramUrl, telegramUrls)] : []),
            ...(instagramUrls.length ? [inArray(leadProspects.publicInstagramUrl, instagramUrls)] : []),
          ),
        ))
      : []
    const knownTelegramUrls = new Set(existingSocialLinks.map((link) => link.telegram).filter((url): url is string => Boolean(url)))
    const knownInstagramUrls = new Set(existingSocialLinks.map((link) => link.instagram).filter((url): url is string => Boolean(url)))
    const freshSocial = socialCandidates.filter((item) => {
      if (item.platform === "telegram") {
        if (knownTelegramUrls.has(item.url)) return false
        knownTelegramUrls.add(item.url)
        return true
      }
      if (knownInstagramUrls.has(item.url)) return false
      knownInstagramUrls.add(item.url)
      return true
    })

    const additions = [...freshWebsites, ...freshSocial].slice(0, available)
    const freshWebsiteAdditions = additions.filter((item) => item.kind === "website")
    const freshSocialAdditions = additions.filter((item) => item.kind === "social")
    const uniqueCount = freshWebsiteAdditions.length + freshSocialAdditions.length
    let researchRunId: string | null = null

    if (uniqueCount) {
      researchRunId = randomUUID()
      await tx.insert(leadResearchRuns).values({
        id: researchRunId,
        userId: input.userId,
        requestedCount: uniqueCount,
        status: freshWebsiteAdditions.length ? "open" : "completed",
      })

      if (freshWebsiteAdditions.length) {
        const inserted = await tx.insert(leadResearchCandidates).values(freshWebsiteAdditions.map((item) => ({
          id: randomUUID(),
          userId: input.userId,
          runId: researchRunId as string,
          searchRunId: input.searchRunId,
          companyName: item.companyName,
          sourceUrl: item.url,
          websiteDomain: item.websiteDomain,
          sourceType: "company_site",
          sourceProvider: "brave_search",
          searchCountry: item.country,
          searchCategory: item.category,
          searchQuery: item.query,
          searchResultTitle: item.title,
          searchResultDescription: item.description,
          status: "pending",
        }))).onConflictDoNothing().returning({ id: leadResearchCandidates.id })
        await tx.update(leadResearchRuns).set({ requestedCount: Math.max(1, inserted.length + freshSocialAdditions.length), updatedAt: new Date() })
          .where(and(eq(leadResearchRuns.id, researchRunId), eq(leadResearchRuns.userId, input.userId)))
      }

      if (freshSocialAdditions.length) {
        await tx.insert(leadProspects).values(freshSocialAdditions.map((item) => ({
          id: randomUUID(),
          userId: input.userId,
          companyName: `${item.platform === "telegram" ? "Telegram" : "Instagram"} · ${item.label}`.slice(0, 160),
          website: null,
          websiteDomain: null,
          sourceUrl: item.url,
          sourceType: "company_site",
          sourceProvider: "brave_search",
          searchCountry: item.country,
          searchCategory: item.category,
          publicTelegramUrl: item.platform === "telegram" ? item.url : null,
          publicInstagramUrl: item.platform === "instagram" ? item.url : null,
          pipelineStage: "new",
          status: "new",
          potentialScore: 50,
          notes: socialOnlyNote,
        }))).onConflictDoNothing()
      }
    }

    const insertedCount = uniqueCount
    const duplicateCount = items.length - insertedCount
    return {
      discoveredCount: insertedCount,
      duplicateCount,
      telegramLinkCount: freshSocialAdditions.filter((item) => item.platform === "telegram").length,
      researchRunId,
    }
  })
}

export async function runLeadHunterSearch(
  userId: string,
  trigger: LeadSearchTrigger,
  options?: { categories: LeadHunterCategory[]; countries: LeadHunterCountry[]; limit: number },
) {
  const [settings] = await db.select().from(leadHunterSettings).where(eq(leadHunterSettings.userId, userId)).limit(1)
  const categories = options?.categories ?? (settings?.searchCategories as LeadHunterCategory[] | undefined) ?? defaultCategories
  const countries = options?.countries ?? (settings?.searchCountries as LeadHunterCountry[] | undefined) ?? defaultCountries
  const requestedLimit = options?.limit ?? settings?.dailyTarget ?? 20
  const dailyTarget = settings?.dailyTarget ?? 20
  const day = new Date().toISOString().slice(0, 10)
  if (trigger === "scheduled") {
    if (!settings?.dailySearchEnabled) return { ok: true as const, skipped: true, reason: "Автопоиск выключен для этого пользователя." }
    if (settings.lastAutomatedSearchDate === day) return { ok: true as const, skipped: true, reason: "Ежедневный поиск уже запускался сегодня." }
  }
  if (!process.env.BRAVE_SEARCH_API_KEY) return { ok: false as const, error: "BRAVE_SEARCH_API_KEY не настроен в окружении приложения." }

  const usageRows = await db.select({ total: sum(leadResearchRuns.requestedCount) })
    .from(leadResearchRuns)
    .where(and(eq(leadResearchRuns.userId, userId), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS))))
  const usage = Number(usageRows[0]?.total ?? 0)
  const remaining = Math.max(0, Math.min(requestedLimit, dailyTarget - usage))
  if (!remaining) return { ok: false as const, error: "Дневной лимит уже использован. Увеличьте дневную цель или повторите позже." }

  if (trigger === "scheduled") {
    await db.update(leadHunterSettings).set({ lastAutomatedSearchDate: day, updatedAt: new Date() })
      .where(eq(leadHunterSettings.userId, userId))
  } else if (settings) {
    await db.update(leadHunterSettings).set({
      searchCategories: categories,
      searchCountries: countries,
      updatedAt: new Date(),
    }).where(eq(leadHunterSettings.userId, userId))
  } else {
    await db.insert(leadHunterSettings).values({
      id: randomUUID(),
      userId,
      dailyTarget,
      dailySearchEnabled: false,
      searchCategories: categories,
      searchCountries: countries,
    }).onConflictDoNothing()
  }

  let discoveredCount = 0
  let duplicateCount = 0
  let telegramLinkCount = 0
  let requestCount = 0
  const searchErrors: string[] = []
  const combinations = rotateCombinations(categories, countries, day)

  for (const combination of combinations) {
    if (discoveredCount >= remaining) break
    const query = buildQuery(combination.category, combination.country)
    const searchRunId = randomUUID()
    await db.insert(leadHunterSearchRuns).values({
      id: searchRunId,
      userId,
      trigger,
      searchCountry: combination.country,
      searchCategory: combination.category,
      query,
      status: "running",
      requestedCount: RESULTS_PER_QUERY,
    })

    try {
      const results = await searchBrave(query, combination.country)
      requestCount += 1
      const candidates = results.map((result) => serializeCandidate(result, query, combination.category, combination.country))
      const result = await persistSearchResults({
        userId,
        searchRunId,
        query,
        category: combination.category,
        country: combination.country,
        candidates,
        remaining: remaining - discoveredCount,
      })
      discoveredCount += result.discoveredCount
      duplicateCount += result.duplicateCount
      telegramLinkCount += result.telegramLinkCount
      await db.update(leadHunterSearchRuns).set({
        status: "completed",
        discoveredCount: result.discoveredCount,
        duplicateCount: result.duplicateCount,
        telegramLinkCount: result.telegramLinkCount,
        finishedAt: new Date(),
      }).where(and(eq(leadHunterSearchRuns.id, searchRunId), eq(leadHunterSearchRuns.userId, userId)))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Поиск не завершился."
      searchErrors.push(message)
      await db.update(leadHunterSearchRuns).set({
        status: "failed",
        errorMessage: message.slice(0, 500),
        finishedAt: new Date(),
      }).where(and(eq(leadHunterSearchRuns.id, searchRunId), eq(leadHunterSearchRuns.userId, userId)))
      if (requestCount === 0) break
    }
  }

  await db.update(leadHunterSettings).set({ updatedAt: new Date() }).where(eq(leadHunterSettings.userId, userId))
  const complete = searchErrors.length === 0
  return {
    ok: requestCount > 0 || discoveredCount > 0,
    discoveredCount,
    duplicateCount,
    telegramLinkCount,
    requestCount,
    error: searchErrors[0],
    partial: !complete,
    message: discoveredCount
      ? `Добавлено в очередь ${discoveredCount} новых записей; найдено ${telegramLinkCount} ссылок Telegram. Анализ сайтов будет выполнен в очереди.`
      : searchErrors.length
        ? "Поиск завершился с ошибкой; подробности сохранены в истории запусков."
        : "Поиск завершён: новых компаний по выбранным критериям не найдено.",
  } as const
}

export async function runDailyLeadHunterSearches() {
  const enabledUsers = await db.select({ userId: leadHunterSettings.userId, dailyTarget: leadHunterSettings.dailyTarget })
    .from(leadHunterSettings)
    .where(eq(leadHunterSettings.dailySearchEnabled, true))
    .orderBy(desc(leadHunterSettings.updatedAt))
    .limit(MAX_SCHEDULED_USERS_PER_RUN)

  const results: { userId: string; search: Awaited<ReturnType<typeof runLeadHunterSearch>>; queuedForAnalysis: number }[] = []
  for (const user of enabledUsers) {
    const search = await runLeadHunterSearch(user.userId, "scheduled")
    const queuedForAnalysis = await processQueuedLeadResearch(user.userId, user.dailyTarget)
    results.push({ userId: user.userId, search, queuedForAnalysis })
  }

  return { processedUsers: results.length, results }
}

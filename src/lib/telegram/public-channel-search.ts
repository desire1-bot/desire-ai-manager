import "server-only"
import { randomUUID } from "node:crypto"
import { and, eq, gte, sql, sum } from "drizzle-orm"
import { Api } from "teleproto"
import { db } from "@/lib/db"
import {
  leadHunterSearchRuns,
  leadHunterSettings,
  leadProspects,
  leadResearchRuns,
} from "@/lib/db/schema"
import { leadHunterCountries } from "@/lib/lead-hunter-options"
import type { LeadHunterCategory, LeadHunterCountry } from "@/lib/lead-research-types"
import { createAuthorizedTelegramClient } from "@/lib/telegram/discovery"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_QUERIES_PER_RUN = 6
const RESULTS_PER_QUERY = 18
const MAX_LEADS_PER_RUN = 50
const defaultCategories: LeadHunterCategory[] = ["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"]
const defaultCountries: LeadHunterCountry[] = ["RU"]

const relevanceTerms: Record<LeadHunterCategory, string[]> = {
  lingerie: ["белье", "бельё", "нижнее белье", "нижнее бельё", "купальник", "корсет"],
  intimate: ["интим", "эротик", "секс", "игрушк", "лубрикант"],
  cosmetics: ["косметик", "уход", "макияж", "крем", "сыворотк", "beauty"],
  lifestyle: ["lifestyle", "лайфстайл", "мода", "спорт", "здоровье", "стиль"],
  gifts: ["подарок", "подарки", "сувенир", "подарочн", "магазин"],
  events: ["мероприят", "ивент", "event", "свадьб", "фестивал", "конференц"],
}

const promotionTerms = [
  "скидк",
  "промокод",
  "акци",
  "заказать",
  "закажи",
  "купить",
  "каталог",
  "новая коллекция",
  "новинка",
  "доставк",
  "коллаборац",
  "сотруднич",
  "партнёрств",
  "партнерств",
  "амбассадор",
]

const contactContext = /контакт|связ|для заказа|заказ|сотруднич|партн[её]р|вопрос|поддерж|доставк|купить|заказать|написать/i
const publisherAdSales = /(?:размещени[ея]|купить|заказать)\s+(?:реклам|пост)|реклам[аы]\s+(?:в канале|у нас|по прайсу)|прайс\s+(?:на\s+)?реклам|по вопросам реклам|админ(?:истратор)?\s+(?:по\s+)?реклам/i
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/g
const externalUrlPattern = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const excludedHosts = new Set(["t.me", "telegram.me", "instagram.com", "vk.com", "youtube.com", "youtu.be"])

type SearchMessage = {
  id?: unknown
  date?: unknown
  message?: unknown
  peerId?: unknown
}

type SearchChannel = {
  id?: unknown
  title?: unknown
  username?: unknown
  broadcast?: unknown
}

type SearchResponse = {
  messages?: unknown
  chats?: unknown
  nextRate?: unknown
}

type TelegramCandidate = {
  channelId: string
  username: string
  title: string
  channelUrl: string
  sourceUrl: string
  website: string | null
  websiteDomain: string | null
  publicEmail: string | null
  publicPhone: string | null
  category: LeadHunterCategory
  country: LeadHunterCountry
  observedAdPosts: number
  recentAdPosts: number
  lastObservedAt: Date
  relevanceScore: number
  cooperationScore: number
  activityScore: number
  budgetPotential: "unknown" | "low" | "medium" | "high"
  signals: string[]
  texts: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null
}

function toStringValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return value.toString()
  }
  return ""
}

function matchingTerms(text: string, terms: string[]) {
  const normalized = text.toLocaleLowerCase("ru-RU")
  return terms.filter((term) => normalized.includes(term.toLocaleLowerCase("ru-RU")))
}

function isPromotionPost(text: string, category: LeadHunterCategory) {
  if (publisherAdSales.test(text)) return false
  const relevant = matchingTerms(text, relevanceTerms[category]).length > 0
  const promotion = matchingTerms(text, promotionTerms).length > 0
  return relevant && promotion
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[),.;!?\]}]+$/g, "")
}

function extractWebsite(texts: string[]) {
  for (const text of texts) {
    if (!contactContext.test(text)) continue
    for (const match of text.matchAll(externalUrlPattern)) {
      const value = stripTrailingPunctuation(match[0])
      const candidate = value.startsWith("www.") ? `https://${value}` : value
      try {
        const url = new URL(candidate)
        const host = url.hostname.toLowerCase().replace(/^www\./, "")
        if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.port || excludedHosts.has(host)) continue
        if (host.includes("telegram") || host.includes("instagram") || host.includes("vk.com")) continue
        return { website: `${url.origin}/`, websiteDomain: host }
      } catch {
        continue
      }
    }
  }
  return { website: null, websiteDomain: null }
}

function extractEmail(texts: string[]) {
  for (const text of texts) {
    if (!contactContext.test(text)) continue
    const match = text.match(emailPattern)?.[0]
    if (match) return match.toLowerCase()
  }
  return null
}

function extractPhone(texts: string[]) {
  for (const text of texts) {
    if (!contactContext.test(text)) continue
    for (const match of text.matchAll(phonePattern)) {
      const digits = match[0].replace(/\D/g, "")
      if (digits.length >= 9 && digits.length <= 15) return match[0].replace(/\s+/g, " ").trim()
    }
  }
  return null
}

function createSearchQuery(category: LeadHunterCategory, country: LeadHunterCountry) {
  const product = relevanceTerms[category].slice(0, 2).join(" ")
  const countryLabel = leadHunterCountries.find((item) => item.id === country)?.label
  if (!countryLabel) throw new Error("Неподдерживаемая страна поиска.")
  return `${product} ${countryLabel} скидка промокод`.slice(0, 180)
}

function rotateCombinations(categories: LeadHunterCategory[], countries: LeadHunterCountry[], day: string) {
  const combinations = categories.flatMap((category) => countries.map((country) => ({ category, country })))
  if (!combinations.length) return []
  const dayNumber = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / DAY_MS)
  const start = dayNumber % combinations.length
  return Array.from({ length: Math.min(MAX_QUERIES_PER_RUN, combinations.length) }, (_, index) => combinations[(start + index) % combinations.length])
}

function extractCandidateGroups(response: SearchResponse, category: LeadHunterCategory, country: LeadHunterCountry) {
  const messages = Array.isArray(response.messages) ? response.messages as SearchMessage[] : []
  const channels = Array.isArray(response.chats) ? response.chats as SearchChannel[] : []
  const channelById = new Map(channels.map((channel) => [toStringValue(channel.id), channel]))
  const grouped = new Map<string, { channel: SearchChannel; posts: { id: string; date: Date; text: string }[] }>()

  for (const message of messages) {
    const record = asRecord(message)
    const peer = asRecord(record?.peerId)
    const channelId = toStringValue(peer?.channelId)
    const channel = channelById.get(channelId)
    const username = typeof channel?.username === "string" ? channel.username : ""
    const text = typeof record?.message === "string" ? record.message.slice(0, 4096) : ""
    const messageId = toStringValue(record?.id)
    const dateSeconds = Number(record?.date)
    if (
      !channel
      || channel.broadcast !== true
      || !/^[a-z0-9_]{5,32}$/i.test(username)
      || !messageId
      || !Number.isFinite(dateSeconds)
      || !text
      || !isPromotionPost(text, category)
    ) continue

    const key = channelId || username.toLowerCase()
    const group = grouped.get(key) ?? { channel, posts: [] }
    if (!group.posts.some((post) => post.id === messageId)) {
      group.posts.push({ id: messageId, date: new Date(dateSeconds * 1000), text })
    }
    grouped.set(key, group)
  }

  return [...grouped.values()].map(({ channel, posts }): TelegramCandidate | null => {
    const username = typeof channel.username === "string" ? channel.username : ""
    const title = typeof channel.title === "string" ? channel.title.trim().slice(0, 160) : ""
    const channelId = toStringValue(channel.id)
    if (!username || !title || !channelId || !posts.length) return null
    const texts = posts.map((post) => post.text)
    const allText = `${title} ${texts.join(" ")}`
    const relevanceMatches = matchingTerms(allText, relevanceTerms[category])
    const hasContact = Boolean(extractEmail(texts) || extractPhone(texts) || extractWebsite(texts).website)
    const hasCollaboration = /сотруднич|партн[её]р|коллаборац|амбассадор/i.test(allText)
    const relevanceScore = Math.min(100, 30 + relevanceMatches.length * 22)
    const cooperationScore = Math.min(100, 25 + (hasCollaboration ? 30 : 0) + (hasContact ? 25 : 0) + (posts.length > 1 ? 20 : 0))
    const activityScore = Math.min(100, posts.length * 20)
    const budgetPotential = posts.length >= 6 ? "high" : posts.length >= 3 ? "medium" : posts.length ? "low" : "unknown"
    const website = extractWebsite(texts)
    const lastObservedAt = posts.reduce((latest, post) => post.date > latest ? post.date : latest, posts[0].date)
    const signals = [
      "Публичная рекламная публикация в целевой категории",
      ...(hasCollaboration ? ["Упоминается сотрудничество или партнёрство"] : []),
      ...(hasContact ? ["В публикации указан рабочий контакт"] : []),
      ...(posts.length > 1 ? ["Найдено несколько рекламных публикаций"] : []),
    ]

    return {
      channelId,
      username,
      title,
      channelUrl: `https://t.me/${username}`,
      sourceUrl: `https://t.me/${username}/${posts.sort((a, b) => b.date.getTime() - a.date.getTime())[0].id}`,
      website: website.website,
      websiteDomain: website.websiteDomain,
      publicEmail: extractEmail(texts),
      publicPhone: extractPhone(texts),
      category,
      country,
      observedAdPosts: posts.length,
      recentAdPosts: posts.filter((post) => Date.now() - post.date.getTime() <= 30 * DAY_MS).length,
      lastObservedAt,
      relevanceScore,
      cooperationScore,
      activityScore,
      budgetPotential,
      signals,
      texts,
    }
  }).filter((candidate): candidate is TelegramCandidate => candidate !== null)
}

function toInsights(candidate: TelegramCandidate) {
  return {
    channelId: candidate.channelId,
    channelUsername: candidate.username,
    sourcePostUrl: candidate.sourceUrl,
    observedAdPosts: candidate.observedAdPosts,
    recentAdPosts: candidate.recentAdPosts,
    lastObservedAt: candidate.lastObservedAt.toISOString(),
    relevanceScore: candidate.relevanceScore,
    cooperationScore: candidate.cooperationScore,
    activityScore: candidate.activityScore,
    budgetPotential: candidate.budgetPotential,
    signals: candidate.signals,
  }
}

async function persistCandidates(userId: string, candidates: TelegramCandidate[], limit: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
    const [settings] = await tx.select({ dailyTarget: leadHunterSettings.dailyTarget }).from(leadHunterSettings)
      .where(eq(leadHunterSettings.userId, userId)).limit(1)
    const usageRows = await tx.select({ total: sum(leadResearchRuns.requestedCount) }).from(leadResearchRuns)
      .where(and(eq(leadResearchRuns.userId, userId), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS))))
    const remaining = Math.max(0, Math.min(limit, (settings?.dailyTarget ?? 20) - Number(usageRows[0]?.total ?? 0)))
    const seenChannels = new Set<string>()
    const seenDomains = new Set<string>()
    let addedCount = 0
    let duplicateCount = 0

    for (const candidate of candidates) {
      const channelKey = candidate.username.toLowerCase()
      const domainKey = candidate.websiteDomain?.toLowerCase() ?? null
      if (seenChannels.has(channelKey) || (domainKey && seenDomains.has(domainKey))) {
        duplicateCount += 1
        continue
      }
      seenChannels.add(channelKey)
      if (domainKey) seenDomains.add(domainKey)

      const match = domainKey
        ? await tx.select({
          id: leadProspects.id,
          sourceProvider: leadProspects.sourceProvider,
          potentialScore: leadProspects.potentialScore,
          website: leadProspects.website,
          websiteDomain: leadProspects.websiteDomain,
          publicEmail: leadProspects.publicEmail,
          publicPhone: leadProspects.publicPhone,
          publicTelegramUrl: leadProspects.publicTelegramUrl,
        }).from(leadProspects).where(and(
          eq(leadProspects.userId, userId),
          eq(leadProspects.websiteDomain, domainKey),
        )).limit(1).then((rows) => rows[0])
        : undefined
      const existing = match ?? await tx.select({
        id: leadProspects.id,
        sourceProvider: leadProspects.sourceProvider,
        potentialScore: leadProspects.potentialScore,
        website: leadProspects.website,
        websiteDomain: leadProspects.websiteDomain,
        publicEmail: leadProspects.publicEmail,
        publicPhone: leadProspects.publicPhone,
        publicTelegramUrl: leadProspects.publicTelegramUrl,
      }).from(leadProspects).where(and(
        eq(leadProspects.userId, userId),
        eq(leadProspects.publicTelegramUrl, candidate.channelUrl),
      )).limit(1).then((rows) => rows[0])

      if (existing) {
        await tx.update(leadProspects).set({
          website: existing.website ?? candidate.website,
          websiteDomain: existing.websiteDomain ?? candidate.websiteDomain,
          publicEmail: existing.publicEmail ?? candidate.publicEmail,
          publicPhone: existing.publicPhone ?? candidate.publicPhone,
          publicTelegramUrl: existing.publicTelegramUrl ?? candidate.channelUrl,
          telegramInsights: toInsights(candidate),
          potentialScore: existing.sourceProvider === "telegram_mtproto"
            ? Math.max(existing.potentialScore, Math.round(candidate.relevanceScore * 0.45 + candidate.cooperationScore * 0.35 + candidate.activityScore * 0.2))
            : existing.potentialScore,
          updatedAt: new Date(),
        }).where(and(eq(leadProspects.id, existing.id), eq(leadProspects.userId, userId)))
        duplicateCount += 1
        continue
      }

      if (addedCount >= remaining) {
        duplicateCount += 1
        continue
      }

      const potentialScore = Math.round(candidate.relevanceScore * 0.45 + candidate.cooperationScore * 0.35 + candidate.activityScore * 0.2)
      const inserted = await tx.insert(leadProspects).values({
        id: randomUUID(),
        userId,
        companyName: candidate.title,
        website: candidate.website,
        websiteDomain: candidate.websiteDomain,
        publicEmail: candidate.publicEmail,
        publicPhone: candidate.publicPhone,
        publicTelegramUrl: candidate.channelUrl,
        sourceUrl: candidate.sourceUrl,
        sourceType: "telegram_public_channel",
        sourceProvider: "telegram_mtproto",
        searchCategory: candidate.category,
        searchCountry: candidate.country,
        pipelineStage: potentialScore >= 80 ? "priority" : "new",
        status: "new",
        potentialScore,
        telegramInsights: toInsights(candidate),
      }).onConflictDoNothing().returning({ id: leadProspects.id })

      if (inserted.length) addedCount += 1
      else duplicateCount += 1
    }

    if (addedCount) {
      await tx.insert(leadResearchRuns).values({
        id: randomUUID(),
        userId,
        requestedCount: addedCount,
        status: "completed",
      })
    }

    return { addedCount, duplicateCount }
  })
}

export async function runTelegramPublicChannelSearch(
  userId: string,
  trigger: "manual" | "scheduled",
  options?: { categories?: LeadHunterCategory[]; countries?: LeadHunterCountry[]; limit?: number },
) {
  const [settings] = await db.select({
    dailyTarget: leadHunterSettings.dailyTarget,
    dailySearchEnabled: leadHunterSettings.dailySearchEnabled,
    telegramDiscoveryEnabled: leadHunterSettings.telegramDiscoveryEnabled,
    searchCategories: leadHunterSettings.searchCategories,
    searchCountries: leadHunterSettings.searchCountries,
    lastTelegramAutomatedSearchDate: leadHunterSettings.lastTelegramAutomatedSearchDate,
  }).from(leadHunterSettings).where(eq(leadHunterSettings.userId, userId)).limit(1)

  const categories = options?.categories ?? (settings?.searchCategories as LeadHunterCategory[] | undefined) ?? defaultCategories
  const countries = options?.countries ?? (settings?.searchCountries as LeadHunterCountry[] | undefined) ?? defaultCountries
  const dailyTarget = settings?.dailyTarget ?? 20
  const day = new Date().toISOString().slice(0, 10)
  if (trigger === "scheduled") {
    if (!settings?.dailySearchEnabled || !settings.telegramDiscoveryEnabled) {
      return { ok: true as const, skipped: true, discoveredCount: 0, duplicateCount: 0, message: "Ежедневный поиск Telegram выключен." }
    }
    if (settings.lastTelegramAutomatedSearchDate === day) {
      return { ok: true as const, skipped: true, discoveredCount: 0, duplicateCount: 0, message: "Ежедневный поиск Telegram уже выполнялся сегодня." }
    }
    await db.update(leadHunterSettings).set({ lastTelegramAutomatedSearchDate: day, updatedAt: new Date() })
      .where(eq(leadHunterSettings.userId, userId))
  }

  const usageRows = await db.select({ total: sum(leadResearchRuns.requestedCount) }).from(leadResearchRuns)
    .where(and(eq(leadResearchRuns.userId, userId), gte(leadResearchRuns.createdAt, new Date(Date.now() - DAY_MS))))
  const usage = Number(usageRows[0]?.total ?? 0)
  const limit = Math.max(0, Math.min(options?.limit ?? dailyTarget, dailyTarget - usage, MAX_LEADS_PER_RUN))
  if (!limit) return { ok: false as const, skipped: false, discoveredCount: 0, duplicateCount: 0, error: "Дневной лимит уже использован." }

  const combinations = rotateCombinations(categories, countries, day)
  if (!combinations.length) return { ok: false as const, skipped: false, discoveredCount: 0, duplicateCount: 0, error: "Выберите хотя бы одну категорию и страну." }

  const searchRunId = randomUUID()
  const first = combinations[0]
  const queryLabel = combinations.map(({ category, country }) => `${category}/${country}`).join(", ")
  await db.insert(leadHunterSearchRuns).values({
    id: searchRunId,
    userId,
    trigger,
    searchCountry: first.country,
    searchCategory: first.category,
    query: `Telegram MTProto · ${queryLabel}`,
    status: "running",
    requestedCount: 0,
  })

  let client: Awaited<ReturnType<typeof createAuthorizedTelegramClient>> | null = null
  let totalMessages = 0
  try {
    client = await createAuthorizedTelegramClient(userId)
    const grouped = new Map<string, TelegramCandidate>()
    const minDate = Math.floor((Date.now() - 30 * DAY_MS) / 1000)

    for (const combination of combinations) {
      if (grouped.size >= limit) break
      const response = await client.invoke(new Api.messages.SearchGlobal({
        broadcastsOnly: true,
        q: createSearchQuery(combination.category, combination.country),
        filter: new Api.InputMessagesFilterEmpty(),
        minDate,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit: RESULTS_PER_QUERY,
      })) as SearchResponse
      const messages = Array.isArray(response.messages) ? response.messages : []
      totalMessages += messages.length
      const candidates = extractCandidateGroups(response, combination.category, combination.country)

      for (const candidate of candidates) {
        const key = candidate.username.toLowerCase()
        const existing = grouped.get(key)
        if (!existing) {
          grouped.set(key, candidate)
          continue
        }
        const combinedTexts = [...new Set([...existing.texts, ...candidate.texts])]
        const merged = extractCandidateGroups({
          messages: combinedTexts.map((text, index) => ({
            id: String(index + 1),
            date: Math.floor(candidate.lastObservedAt.getTime() / 1000),
            message: text,
            peerId: { channelId: candidate.channelId },
          })),
          chats: [{
            id: candidate.channelId,
            title: candidate.title,
            username: candidate.username,
            broadcast: true,
          }],
        }, existing.category, existing.country)[0]
        if (merged) {
          grouped.set(key, {
            ...merged,
            observedAdPosts: existing.observedAdPosts + candidate.observedAdPosts,
            recentAdPosts: existing.recentAdPosts + candidate.recentAdPosts,
            lastObservedAt: existing.lastObservedAt > candidate.lastObservedAt ? existing.lastObservedAt : candidate.lastObservedAt,
            category: candidate.relevanceScore > existing.relevanceScore ? candidate.category : existing.category,
            country: candidate.relevanceScore > existing.relevanceScore ? candidate.country : existing.country,
          })
        }
      }
    }

    const candidates = [...grouped.values()]
      .sort((a, b) => (b.relevanceScore + b.cooperationScore + b.activityScore) - (a.relevanceScore + a.cooperationScore + a.activityScore))
      .slice(0, limit)
    const persisted = await persistCandidates(userId, candidates, limit)
    await db.update(leadHunterSearchRuns).set({
      status: "completed",
      requestedCount: Math.min(totalMessages, 50),
      discoveredCount: persisted.addedCount,
      duplicateCount: persisted.duplicateCount,
      telegramLinkCount: candidates.length,
      finishedAt: new Date(),
    }).where(and(eq(leadHunterSearchRuns.id, searchRunId), eq(leadHunterSearchRuns.userId, userId)))

    return {
      ok: true as const,
      skipped: false,
      discoveredCount: persisted.addedCount,
      duplicateCount: persisted.duplicateCount,
      message: `В публичных каналах найдено новых карточек: ${persisted.addedCount}; обновлено или пропущено дубликатов: ${persisted.duplicateCount}.`,
    }
  } catch (error) {
    const message = error instanceof Error && error.message === "TELEGRAM_NOT_CONNECTED"
      ? "Сначала подключите Telegram-аккаунт для поиска публичных каналов."
      : "Telegram временно недоступен или ограничил поиск. Попробуйте позже."
    await db.update(leadHunterSearchRuns).set({
      status: "failed",
      requestedCount: Math.min(totalMessages, 50),
      errorMessage: message,
      finishedAt: new Date(),
    }).where(and(eq(leadHunterSearchRuns.id, searchRunId), eq(leadHunterSearchRuns.userId, userId)))
    return { ok: false as const, skipped: false, discoveredCount: 0, duplicateCount: 0, error: message }
  } finally {
    if (client) await client.disconnect().catch(() => undefined)
  }
}

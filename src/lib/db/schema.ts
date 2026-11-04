import { date, integer, numeric, pgTable, text, timestamp, boolean, uniqueIndex, check, index, jsonb } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import type { LeadResearchEvidence, LeadResearchSourceCheckResults } from "@/lib/lead-research-types"

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow(),
})

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  firstName: text("firstName").notNull(),
  lastName: text("lastName").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  companyId: text("companyId"),
  status: text("status").notNull().default("lead"),
  notes: text("notes"),
  telegramUserId: text("telegramUserId"),
  telegramUsername: text("telegramUsername"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const deals = pgTable("deals", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  companyId: text("companyId"),
  contactId: text("contactId"),
  value: numeric("value", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  stage: text("stage").notNull().default("qualification"),
  probability: integer("probability").notNull().default(10),
  expectedCloseDate: date("expectedCloseDate", { mode: "string" }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const crmTasks = pgTable("crm_tasks", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  dueDate: timestamp("dueDate", { withTimezone: true }),
  contactId: text("contactId"),
  dealId: text("dealId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export type TelegramLeadInsights = {
  channelId: string
  channelUsername: string
  sourcePostUrl: string
  observedAdPosts: number
  recentAdPosts: number
  lastObservedAt: string
  relevanceScore: number
  cooperationScore: number
  activityScore: number
  budgetPotential: "unknown" | "low" | "medium" | "high"
  signals: string[]
}

export const leadProspects = pgTable("lead_prospects", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  companyName: text("companyName").notNull(),
  website: text("website"),
  websiteDomain: text("websiteDomain"),
  industry: text("industry"),
  region: text("region"),
  publicEmail: text("publicEmail"),
  publicPhone: text("publicPhone"),
  publicTelegramUrl: text("publicTelegramUrl"),
  publicInstagramUrl: text("publicInstagramUrl"),
  sourceUrl: text("sourceUrl").notNull(),
  sourceType: text("sourceType").notNull().default("company_site"),
  sourceProvider: text("sourceProvider").notNull().default("manual"),
  searchCategory: text("searchCategory"),
  searchCountry: text("searchCountry"),
  pipelineStage: text("pipelineStage").notNull().default("new"),
  status: text("status").notNull().default("new"),
  potentialScore: integer("potentialScore").notNull().default(50),
  notes: text("notes"),
  telegramInsights: jsonb("telegramInsights").$type<TelegramLeadInsights>(),
  discoveredAt: timestamp("discoveredAt", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
  companyId: text("companyId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lead_prospects_user_domain_unique").on(table.userId, table.websiteDomain).where(sql`${table.websiteDomain} is not null`),
  index("lead_prospects_user_telegram_url_idx").on(table.userId, table.publicTelegramUrl),
  index("lead_prospects_user_instagram_url_idx").on(table.userId, table.publicInstagramUrl),
  check("lead_prospects_potential_score_range", sql`${table.potentialScore} between 0 and 100`),
  check("lead_prospects_pipeline_stage_check", sql`${table.pipelineStage} in ('new', 'analyzed', 'priority', 'proposal_prepared', 'sent', 'replied', 'negotiating', 'partnered', 'refused')`),
])

export const leadHunterSettings = pgTable("lead_hunter_settings", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().unique(),
  dailyTarget: integer("dailyTarget").notNull().default(20),
  dailySearchEnabled: boolean("dailySearchEnabled").notNull().default(false),
  telegramDiscoveryEnabled: boolean("telegramDiscoveryEnabled").notNull().default(false),
  searchCountries: jsonb("searchCountries").$type<string[]>().notNull().default(["RU"]),
  searchCategories: jsonb("searchCategories").$type<string[]>().notNull().default(["lingerie", "intimate", "cosmetics", "lifestyle", "gifts", "events"]),
  lastAutomatedSearchDate: text("lastAutomatedSearchDate"),
  lastTelegramAutomatedSearchDate: text("lastTelegramAutomatedSearchDate"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("lead_hunter_daily_target_range", sql`${table.dailyTarget} between 20 and 50`),
])

export const leadResearchRuns = pgTable("lead_research_runs", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  requestedCount: integer("requestedCount").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("lead_research_runs_user_created_idx").on(table.userId, table.createdAt),
  check("lead_research_runs_requested_count_range", sql`${table.requestedCount} between 1 and 50`),
  check("lead_research_runs_status_check", sql`${table.status} in ('open', 'completed')`),
])

export const leadHunterSearchRuns = pgTable("lead_hunter_search_runs", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  trigger: text("trigger").notNull(),
  searchCountry: text("searchCountry").notNull(),
  searchCategory: text("searchCategory").notNull(),
  query: text("query").notNull(),
  status: text("status").notNull().default("running"),
  requestedCount: integer("requestedCount").notNull().default(0),
  discoveredCount: integer("discoveredCount").notNull().default(0),
  duplicateCount: integer("duplicateCount").notNull().default(0),
  telegramLinkCount: integer("telegramLinkCount").notNull().default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finishedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("lead_hunter_search_runs_user_created_idx").on(table.userId, table.createdAt),
  check("lead_hunter_search_runs_trigger_check", sql`${table.trigger} in ('manual', 'scheduled')`),
  check("lead_hunter_search_runs_status_check", sql`${table.status} in ('running', 'completed', 'failed')`),
  check("lead_hunter_search_runs_counts_check", sql`${table.requestedCount} between 0 and 50 and ${table.discoveredCount} between 0 and 50 and ${table.duplicateCount} >= 0 and ${table.telegramLinkCount} between 0 and 50`),
])

export const leadResearchCandidates = pgTable("lead_research_candidates", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  runId: text("runId").notNull(),
  companyName: text("companyName"),
  sourceUrl: text("sourceUrl").notNull(),
  websiteDomain: text("websiteDomain").notNull(),
  sourceTitle: text("sourceTitle"),
  sourceType: text("sourceType").notNull().default("company_site"),
  sourceProvider: text("sourceProvider").notNull().default("manual"),
  searchRunId: text("searchRunId"),
  searchCountry: text("searchCountry"),
  searchCategory: text("searchCategory"),
  searchQuery: text("searchQuery"),
  searchResultTitle: text("searchResultTitle"),
  searchResultDescription: text("searchResultDescription"),
  publicEmail: text("publicEmail"),
  publicPhone: text("publicPhone"),
  instagramUrl: text("instagramUrl"),
  sourceRetrievedAt: timestamp("sourceRetrievedAt", { withTimezone: true }),
  sourceSnapshot: text("sourceSnapshot"),
  sourceFinalUrl: text("sourceFinalUrl"),
  sourceCheckStatus: text("sourceCheckStatus").notNull().default("unchecked"),
  sourceCheckResults: jsonb("sourceCheckResults").$type<LeadResearchSourceCheckResults>().notNull().default({}),
  retryCount: integer("retryCount").notNull().default(0),
  retryable: boolean("retryable").notNull().default(false),
  summary: text("summary"),
  industry: text("industry"),
  region: text("region"),
  fitScore: integer("fitScore"),
  sponsorshipPotential: integer("sponsorshipPotential"),
  barterPotential: integer("barterPotential"),
  cashPotential: integer("cashPotential"),
  advertisingFit: integer("advertisingFit"),
  geographicCoverage: text("geographicCoverage"),
  fitRationale: text("fitRationale"),
  evidence: jsonb("evidence").$type<LeadResearchEvidence[]>().notNull().default([]),
  proposalDraft: text("proposalDraft"),
  emailDraft: text("emailDraft"),
  telegramDraft: text("telegramDraft"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("errorMessage"),
  modelId: text("modelId"),
  analyzedAt: timestamp("analyzedAt", { withTimezone: true }),
  leadProspectId: text("leadProspectId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lead_research_candidates_unique_domain_per_run").on(table.userId, table.runId, table.websiteDomain),
  uniqueIndex("lead_research_candidates_user_domain_unique").on(table.userId, table.websiteDomain),
  index("lead_research_candidates_user_status_created_idx").on(table.userId, table.status, table.createdAt),
  check("lead_research_candidates_status_check", sql`${table.status} in ('pending', 'analyzing', 'analyzed', 'saved', 'rejected', 'failed')`),
  check("lead_research_candidates_source_check_status", sql`${table.sourceCheckStatus} in ('unchecked', 'passed', 'blocked', 'temporary_error')`),
  check("lead_research_candidates_retry_count", sql`${table.retryCount} >= 0`),
  index("lead_research_candidates_search_run_idx").on(table.userId, table.searchRunId),
  check("lead_research_candidates_score_range", sql`${table.fitScore} is null or ${table.fitScore} between 0 and 100`),
  check("lead_research_candidates_sponsor_score_range", sql`(${table.sponsorshipPotential} is null or ${table.sponsorshipPotential} between 0 and 100) and (${table.barterPotential} is null or ${table.barterPotential} between 0 and 100) and (${table.cashPotential} is null or ${table.cashPotential} between 0 and 100) and (${table.advertisingFit} is null or ${table.advertisingFit} between 0 and 100)`),
  check("lead_research_candidates_source_type_check", sql`${table.sourceType} in ('company_site', 'licensed_directory')`),
])

export const leadProspectCommunications = pgTable("lead_prospect_communications", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  leadProspectId: text("leadProspectId").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("draft"),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("lead_prospect_communications_user_prospect_created_idx").on(table.userId, table.leadProspectId, table.createdAt),
  check("lead_prospect_communications_channel_check", sql`${table.channel} in ('email', 'telegram')`),
  check("lead_prospect_communications_status_check", sql`${table.status} in ('draft', 'sent', 'received')`),
])

export const telegramDiscoverySessions = pgTable("telegram_discovery_sessions", {
  userId: text("userId").primaryKey(),
  sessionCiphertext: text("sessionCiphertext"),
  pendingAuthCiphertext: text("pendingAuthCiphertext"),
  accountId: text("accountId"),
  accountUsername: text("accountUsername"),
  connectedAt: timestamp("connectedAt", { withTimezone: true }),
  lastCodeRequestedAt: timestamp("lastCodeRequestedAt", { withTimezone: true }),
  failureWindowStartedAt: timestamp("failureWindowStartedAt", { withTimezone: true }),
  failedAttempts: integer("failedAttempts").notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("telegram_discovery_sessions_failed_attempts_check", sql`${table.failedAttempts} between 0 and 5`),
])

export const telegramSettings = pgTable("telegram_settings", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
})

export const telegramConversations = pgTable("telegram_conversations", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  contactId: text("contactId").notNull(),
  telegramUserId: text("telegramUserId").notNull(),
  username: text("username"),
  firstName: text("firstName").notNull(),
  lastName: text("lastName"),
  lastMessageAt: timestamp("lastMessageAt", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const telegramMessages = pgTable("telegram_messages", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  conversationId: text("conversationId").notNull(),
  telegramMessageId: text("telegramMessageId"),
  telegramUpdateId: text("telegramUpdateId"),
  direction: text("direction").notNull(),
  text: text("text").notNull(),
  sentAt: timestamp("sentAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
})

export const telegramReplyDrafts = pgTable("telegram_reply_drafts", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  conversationId: text("conversationId").notNull(),
  inboundMessageId: text("inboundMessageId").notNull().unique(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewedBy"),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
  sentAt: timestamp("sentAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

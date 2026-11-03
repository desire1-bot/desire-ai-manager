import { date, integer, numeric, pgTable, text, timestamp, boolean, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

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
  sourceUrl: text("sourceUrl").notNull(),
  sourceType: text("sourceType").notNull().default("company_site"),
  status: text("status").notNull().default("new"),
  potentialScore: integer("potentialScore").notNull().default(50),
  notes: text("notes"),
  discoveredAt: timestamp("discoveredAt", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
  companyId: text("companyId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lead_prospects_user_domain_unique").on(table.userId, table.websiteDomain).where(sql`${table.websiteDomain} is not null`),
  check("lead_prospects_potential_score_range", sql`${table.potentialScore} between 0 and 100`),
])

export const leadHunterSettings = pgTable("lead_hunter_settings", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().unique(),
  dailyTarget: integer("dailyTarget").notNull().default(20),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("lead_hunter_daily_target_range", sql`${table.dailyTarget} between 20 and 50`),
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

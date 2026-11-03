"use server"

import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { companies, leadHunterSettings, leadProspects } from "@/lib/db/schema"

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
  publicEmail: optionalEmail,
  publicPhone: z.string().trim().max(40).optional(),
  publicTelegramUrl: optionalUrl,
  sourceUrl: httpUrl,
  sourceType: z.enum(["company_site", "licensed_directory"]),
  potentialScore: z.coerce.number().int().min(0).max(100),
  notes: z.string().trim().max(1000).optional(),
  verified: z.literal("on").optional(),
})
const statusSchema = z.enum(["new", "verified", "qualified", "rejected"])
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
      publicEmail: parsed.data.publicEmail || null,
      publicPhone: parsed.data.publicPhone || null,
      publicTelegramUrl: parsed.data.publicTelegramUrl || null,
      sourceUrl: new URL(parsed.data.sourceUrl).toString(),
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
  const [lead] = await db.select({ status: leadProspects.status, verifiedAt: leadProspects.verifiedAt })
    .from(leadProspects).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId))).limit(1)
  if (!lead) return { ok: false as const, error: "Карточка лида не найдена." }
  if (lead.status === "converted") return { ok: false as const, error: "Компания уже добавлена в CRM." }
  if (parsedStatus.data === "qualified" && !["verified", "qualified"].includes(lead.status)) {
    return { ok: false as const, error: "Сначала откройте и проверьте первоисточник." }
  }

  await db.update(leadProspects).set({
    status: parsedStatus.data,
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
      status: "converted", companyId, updatedAt: new Date(),
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
  await db.delete(leadProspects).where(and(eq(leadProspects.id, id), eq(leadProspects.userId, userId)))
  revalidatePath("/leads")
  return { ok: true as const }
}

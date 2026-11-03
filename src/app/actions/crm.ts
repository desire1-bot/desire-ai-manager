"use server"

import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { companies, contacts, crmTasks, deals } from "@/lib/db/schema"

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(100).optional(),
  companyId: z.string().max(80).optional(),
})
const companySchema = z.object({
  name: z.string().trim().min(1).max(160),
  domain: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(100).optional(),
})
const dealSchema = z.object({
  title: z.string().trim().min(1).max(160),
  value: z.coerce.number().min(0).max(999999999),
  stage: z.enum(["qualification", "proposal", "negotiation", "won", "lost"]),
  expectedCloseDate: z.string().max(10).refine((value) => !value || (!Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && /^\d{4}-\d{2}-\d{2}$/.test(value))).optional(),
  companyId: z.string().max(80).optional(),
  contactId: z.string().max(80).optional(),
})
const taskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().max(40).refine((value) => !value || !Number.isNaN(Date.parse(value))).optional(),
})

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

function invalidInput() {
  return { ok: false as const, error: "Проверьте заполненные поля и попробуйте ещё раз." }
}

export async function createContact(input: unknown) {
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) return invalidInput()
  const userId = await getUserId()
  const companyId = parsed.data.companyId || null
  if (companyId) {
    const [company] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), eq(companies.userId, userId))).limit(1)
    if (!company) return { ok: false as const, error: "Компания не найдена." }
  }
  await db.insert(contacts).values({
    id: randomUUID(), userId, firstName: parsed.data.firstName, lastName: parsed.data.lastName,
    email: parsed.data.email || null, phone: parsed.data.phone || null, title: parsed.data.title || null,
    companyId, status: "lead",
  })
  revalidatePath("/dashboard")
  revalidatePath("/contacts")
  return { ok: true as const }
}

export async function createCompany(input: unknown) {
  const parsed = companySchema.safeParse(input)
  if (!parsed.success) return invalidInput()
  const userId = await getUserId()
  await db.insert(companies).values({
    id: randomUUID(), userId, name: parsed.data.name,
    domain: parsed.data.domain || null, industry: parsed.data.industry || null,
  })
  revalidatePath("/dashboard")
  revalidatePath("/companies")
  return { ok: true as const }
}

export async function createDeal(input: unknown) {
  const parsed = dealSchema.safeParse(input)
  if (!parsed.success) return invalidInput()
  const userId = await getUserId()
  if (parsed.data.companyId) {
    const [company] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, parsed.data.companyId), eq(companies.userId, userId))).limit(1)
    if (!company) return { ok: false as const, error: "Компания не найдена." }
  }
  if (parsed.data.contactId) {
    const [contact] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, parsed.data.contactId), eq(contacts.userId, userId))).limit(1)
    if (!contact) return { ok: false as const, error: "Контакт не найден." }
  }
  await db.insert(deals).values({
    id: randomUUID(), userId, title: parsed.data.title, value: parsed.data.value,
    stage: parsed.data.stage, expectedCloseDate: parsed.data.expectedCloseDate || null,
    companyId: parsed.data.companyId || null, contactId: parsed.data.contactId || null,
    probability: parsed.data.stage === "won" ? 100 : parsed.data.stage === "lost" ? 0 : 30,
  })
  revalidatePath("/dashboard")
  revalidatePath("/deals")
  revalidatePath("/reports")
  return { ok: true as const }
}

export async function createTask(input: unknown) {
  const parsed = taskSchema.safeParse(input)
  if (!parsed.success) return invalidInput()
  const userId = await getUserId()
  await db.insert(crmTasks).values({
    id: randomUUID(), userId, title: parsed.data.title,
    description: parsed.data.description || null,
    priority: parsed.data.priority,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
  })
  revalidatePath("/dashboard")
  revalidatePath("/tasks")
  return { ok: true as const }
}

export async function updateTaskStatus(id: string, status: "open" | "done") {
  const userId = await getUserId()
  if (!z.string().uuid().safeParse(id).success || !["open", "done"].includes(status)) return invalidInput()
  await db.update(crmTasks).set({ status, updatedAt: new Date() }).where(and(eq(crmTasks.id, id), eq(crmTasks.userId, userId)))
  revalidatePath("/dashboard")
  revalidatePath("/tasks")
  return { ok: true as const }
}

export async function updateDealStage(id: string, stage: "qualification" | "proposal" | "negotiation" | "won" | "lost") {
  const userId = await getUserId()
  const validStage = z.enum(["qualification", "proposal", "negotiation", "won", "lost"]).safeParse(stage)
  if (!z.string().uuid().safeParse(id).success || !validStage.success) return invalidInput()
  await db.update(deals).set({ stage, probability: stage === "won" ? 100 : stage === "lost" ? 0 : stage === "negotiation" ? 65 : stage === "proposal" ? 45 : 20, updatedAt: new Date() }).where(and(eq(deals.id, id), eq(deals.userId, userId)))
  revalidatePath("/dashboard")
  revalidatePath("/deals")
  revalidatePath("/reports")
  return { ok: true as const }
}

export async function deleteCrmRecord(kind: "contact" | "company" | "deal" | "task", id: string) {
  const userId = await getUserId()
  const validKind = z.enum(["contact", "company", "deal", "task"]).safeParse(kind)
  if (!validKind.success || !z.string().uuid().safeParse(id).success) return invalidInput()
  if (validKind.data === "contact") await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
  if (validKind.data === "company") await db.delete(companies).where(and(eq(companies.id, id), eq(companies.userId, userId)))
  if (validKind.data === "deal") await db.delete(deals).where(and(eq(deals.id, id), eq(deals.userId, userId)))
  if (validKind.data === "task") await db.delete(crmTasks).where(and(eq(crmTasks.id, id), eq(crmTasks.userId, userId)))
  revalidatePath("/dashboard")
  revalidatePath("/contacts")
  revalidatePath("/companies")
  revalidatePath("/deals")
  revalidatePath("/tasks")
  revalidatePath("/reports")
  return { ok: true as const }
}

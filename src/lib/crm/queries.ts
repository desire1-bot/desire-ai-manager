import { and, asc, count, desc, eq, gte, inArray, isNotNull, ne, sum } from "drizzle-orm"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { companies, contacts, crmTasks, deals, leadHunterSettings, leadProspects, leadResearchCandidates, leadResearchRuns } from "@/lib/db/schema"
import type { LeadResearchEvidence, LeadResearchOverview, LeadResearchSourceCheckStatus, LeadResearchStatus, LeadResearchSourceType } from "@/lib/lead-research-types"

export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ?? null
}

export async function requireCurrentUser() {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized")
  return user
}

export async function getDashboardData(userId: string) {
  const [contactTotal, companyTotal, openDeals, activeTaskTotal, recentDeals, upcomingTasks, pipeline] = await Promise.all([
    db.select({ total: count() }).from(contacts).where(eq(contacts.userId, userId)),
    db.select({ total: count() }).from(companies).where(eq(companies.userId, userId)),
    db.select({ total: sum(deals.value) }).from(deals).where(and(eq(deals.userId, userId), ne(deals.stage, "won"), ne(deals.stage, "lost"))),
    db.select({ total: count() }).from(crmTasks).where(and(eq(crmTasks.userId, userId), ne(crmTasks.status, "done"))),
    db.select({ id: deals.id, title: deals.title, value: deals.value, stage: deals.stage, updatedAt: deals.updatedAt }).from(deals).where(eq(deals.userId, userId)).orderBy(desc(deals.updatedAt)).limit(5),
    db.select({ id: crmTasks.id, title: crmTasks.title, dueDate: crmTasks.dueDate, priority: crmTasks.priority, status: crmTasks.status }).from(crmTasks).where(and(eq(crmTasks.userId, userId), ne(crmTasks.status, "done"))).orderBy(asc(crmTasks.dueDate)).limit(5),
    db.select({ stage: deals.stage, amount: sum(deals.value), total: count() }).from(deals).where(eq(deals.userId, userId)).groupBy(deals.stage),
  ])

  return {
    contacts: contactTotal[0]?.total ?? 0,
    companies: companyTotal[0]?.total ?? 0,
    openDealValue: Number(openDeals[0]?.total ?? 0),
    activeTasks: activeTaskTotal[0]?.total ?? 0,
    recentDeals: recentDeals.map((deal) => ({ ...deal, value: Number(deal.value) })),
    upcomingTasks: upcomingTasks.map((task) => ({ ...task, dueDate: task.dueDate?.toISOString() ?? null })),
    pipeline: pipeline.map((stage) => ({ stage: stage.stage, amount: Number(stage.amount ?? 0), total: stage.total })),
  }
}

export async function getContacts(userId: string) {
  const rows = await db.select({
    id: contacts.id,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
    phone: contacts.phone,
    title: contacts.title,
    status: contacts.status,
    companyName: companies.name,
    createdAt: contacts.createdAt,
  }).from(contacts).leftJoin(companies, and(eq(contacts.companyId, companies.id), eq(companies.userId, userId))).where(eq(contacts.userId, userId)).orderBy(desc(contacts.createdAt))

  return rows.map((contact) => ({ ...contact, createdAt: contact.createdAt.toISOString() }))
}

export async function getCompanies(userId: string) {
  const rows = await db.select({
    id: companies.id,
    name: companies.name,
    domain: companies.domain,
    industry: companies.industry,
    createdAt: companies.createdAt,
    contactCount: count(contacts.id),
  }).from(companies)
    .leftJoin(contacts, and(eq(contacts.companyId, companies.id), eq(contacts.userId, userId)))
    .where(eq(companies.userId, userId))
    .groupBy(companies.id, companies.name, companies.domain, companies.industry, companies.createdAt)
    .orderBy(asc(companies.name))

  return rows.map((company) => ({ ...company, createdAt: company.createdAt.toISOString() }))
}

export async function getDeals(userId: string) {
  const rows = await db.select({
    id: deals.id,
    title: deals.title,
    value: deals.value,
    stage: deals.stage,
    expectedCloseDate: deals.expectedCloseDate,
    updatedAt: deals.updatedAt,
    companyName: companies.name,
    contactFirstName: contacts.firstName,
    contactLastName: contacts.lastName,
  }).from(deals)
    .leftJoin(companies, and(eq(deals.companyId, companies.id), eq(companies.userId, userId)))
    .leftJoin(contacts, and(eq(deals.contactId, contacts.id), eq(contacts.userId, userId)))
    .where(eq(deals.userId, userId))
    .orderBy(desc(deals.updatedAt))

  return rows.map((deal) => ({ ...deal, value: Number(deal.value), updatedAt: deal.updatedAt.toISOString() }))
}

export async function getTasks(userId: string) {
  const rows = await db.select({
    id: crmTasks.id,
    title: crmTasks.title,
    description: crmTasks.description,
    status: crmTasks.status,
    priority: crmTasks.priority,
    dueDate: crmTasks.dueDate,
    contactFirstName: contacts.firstName,
    contactLastName: contacts.lastName,
    dealTitle: deals.title,
  }).from(crmTasks)
    .leftJoin(contacts, and(eq(crmTasks.contactId, contacts.id), eq(contacts.userId, userId)))
    .leftJoin(deals, and(eq(crmTasks.dealId, deals.id), eq(deals.userId, userId)))
    .where(eq(crmTasks.userId, userId))
    .orderBy(asc(crmTasks.dueDate))

  return rows.map((task) => ({ ...task, dueDate: task.dueDate?.toISOString() ?? null }))
}

export async function getLeadHunterData(userId: string) {
  const [rows, settings] = await Promise.all([
    db.select({
      id: leadProspects.id,
      companyName: leadProspects.companyName,
      website: leadProspects.website,
      websiteDomain: leadProspects.websiteDomain,
      industry: leadProspects.industry,
      region: leadProspects.region,
      publicEmail: leadProspects.publicEmail,
      publicPhone: leadProspects.publicPhone,
      publicTelegramUrl: leadProspects.publicTelegramUrl,
      sourceUrl: leadProspects.sourceUrl,
      sourceType: leadProspects.sourceType,
      status: leadProspects.status,
      potentialScore: leadProspects.potentialScore,
      notes: leadProspects.notes,
      discoveredAt: leadProspects.discoveredAt,
      verifiedAt: leadProspects.verifiedAt,
      companyId: leadProspects.companyId,
    }).from(leadProspects).where(eq(leadProspects.userId, userId)).orderBy(desc(leadProspects.discoveredAt)),
    db.select({ dailyTarget: leadHunterSettings.dailyTarget }).from(leadHunterSettings)
      .where(eq(leadHunterSettings.userId, userId)).limit(1),
  ])

  return {
    leads: rows.map((lead) => ({
      ...lead,
      sourceType: lead.sourceType as "company_site" | "licensed_directory",
      status: lead.status as "new" | "verified" | "qualified" | "rejected" | "converted",
      discoveredAt: lead.discoveredAt.toISOString(),
      verifiedAt: lead.verifiedAt?.toISOString() ?? null,
    })),
    dailyTarget: settings[0]?.dailyTarget ?? 20,
  }
}

export async function getLeadResearchData(userId: string): Promise<LeadResearchOverview> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [rows, queued, analyzed, promising, proposals, usage] = await Promise.all([
    db.select({
      id: leadResearchCandidates.id,
      runId: leadResearchCandidates.runId,
      companyName: leadResearchCandidates.companyName,
      sourceUrl: leadResearchCandidates.sourceUrl,
      websiteDomain: leadResearchCandidates.websiteDomain,
      sourceTitle: leadResearchCandidates.sourceTitle,
      sourceType: leadResearchCandidates.sourceType,
      sourceRetrievedAt: leadResearchCandidates.sourceRetrievedAt,
      sourceCheckStatus: leadResearchCandidates.sourceCheckStatus,
      sourceCheckResults: leadResearchCandidates.sourceCheckResults,
      retryCount: leadResearchCandidates.retryCount,
      retryable: leadResearchCandidates.retryable,
      summary: leadResearchCandidates.summary,
      industry: leadResearchCandidates.industry,
      region: leadResearchCandidates.region,
      fitScore: leadResearchCandidates.fitScore,
      fitRationale: leadResearchCandidates.fitRationale,
      evidence: leadResearchCandidates.evidence,
      proposalDraft: leadResearchCandidates.proposalDraft,
      status: leadResearchCandidates.status,
      errorMessage: leadResearchCandidates.errorMessage,
      analyzedAt: leadResearchCandidates.analyzedAt,
      leadProspectId: leadResearchCandidates.leadProspectId,
      createdAt: leadResearchCandidates.createdAt,
      updatedAt: leadResearchCandidates.updatedAt,
    }).from(leadResearchCandidates)
      .where(eq(leadResearchCandidates.userId, userId))
      .orderBy(desc(leadResearchCandidates.createdAt))
      .limit(100),
    db.select({ total: count() }).from(leadResearchCandidates).where(and(
      eq(leadResearchCandidates.userId, userId),
      inArray(leadResearchCandidates.status, ["pending", "analyzing", "failed"]),
    )),
    db.select({ total: count() }).from(leadResearchCandidates).where(and(
      eq(leadResearchCandidates.userId, userId),
      inArray(leadResearchCandidates.status, ["analyzed", "saved"]),
    )),
    db.select({ total: count() }).from(leadResearchCandidates).where(and(
      eq(leadResearchCandidates.userId, userId),
      gte(leadResearchCandidates.fitScore, 80),
      ne(leadResearchCandidates.status, "rejected"),
    )),
    db.select({ total: count() }).from(leadResearchCandidates).where(and(
      eq(leadResearchCandidates.userId, userId),
      isNotNull(leadResearchCandidates.proposalDraft),
    )),
    db.select({ total: sum(leadResearchRuns.requestedCount) }).from(leadResearchRuns).where(and(
      eq(leadResearchRuns.userId, userId),
      gte(leadResearchRuns.createdAt, since),
    )),
  ])

  return {
    candidates: rows.map((candidate) => ({
      ...candidate,
      sourceType: candidate.sourceType as LeadResearchSourceType,
      status: candidate.status as LeadResearchStatus,
      sourceCheckStatus: candidate.sourceCheckStatus as LeadResearchSourceCheckStatus,
      evidence: (candidate.evidence ?? []) as LeadResearchEvidence[],
      sourceCheckResults: candidate.sourceCheckResults ?? {},
      sourceRetrievedAt: candidate.sourceRetrievedAt?.toISOString() ?? null,
      analyzedAt: candidate.analyzedAt?.toISOString() ?? null,
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
    })),
    stats: {
      queued: queued[0]?.total ?? 0,
      analyzed: analyzed[0]?.total ?? 0,
      promising: promising[0]?.total ?? 0,
      proposals: proposals[0]?.total ?? 0,
    },
    usageLast24Hours: Number(usage[0]?.total ?? 0),
  }
}

export async function getReportData(userId: string) {
  const [pipeline, contactStatuses, dealCount] = await Promise.all([
    db.select({ stage: deals.stage, amount: sum(deals.value), total: count() }).from(deals).where(eq(deals.userId, userId)).groupBy(deals.stage),
    db.select({ status: contacts.status, total: count() }).from(contacts).where(eq(contacts.userId, userId)).groupBy(contacts.status),
    db.select({ total: count() }).from(deals).where(eq(deals.userId, userId)),
  ])

  return {
    pipeline: pipeline.map((stage) => ({ ...stage, amount: Number(stage.amount ?? 0) })),
    contactStatuses,
    totalDeals: dealCount[0]?.total ?? 0,
  }
}

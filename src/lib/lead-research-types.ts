export type LeadResearchSourceType = "company_site" | "licensed_directory"
export type LeadSearchTrigger = "manual" | "scheduled"
export type LeadSearchRunStatus = "running" | "completed" | "failed"
export type LeadCommunicationChannel = "email" | "telegram"
export type LeadCommunicationStatus = "draft" | "sent" | "received"
export type LeadPipelineStage = "new" | "analyzed" | "priority" | "proposal_prepared" | "sent" | "replied" | "negotiating" | "partnered" | "refused"

export type LeadResearchStatus = "pending" | "analyzing" | "analyzed" | "saved" | "rejected" | "failed"

export type LeadResearchSourceCheckStatus = "unchecked" | "passed" | "blocked" | "temporary_error"

export type LeadResearchSourceCheckResults = {
  publicDns?: boolean
  robots?: "allowed" | "not_published"
  contentType?: string
  responseBytes?: number
  redirectCount?: number
  checkedAt?: string
  error?: string
}

export type LeadResearchEvidenceField = "companyName" | "industry" | "region" | "summary" | "fitRationale"

export type LeadResearchEvidence = {
  field: LeadResearchEvidenceField
  claim: string
  quote: string
  sourceUrl: string
}

export type LeadResearchCandidateView = {
  id: string
  runId: string
  companyName: string | null
  sourceUrl: string
  websiteDomain: string
  sourceTitle: string | null
  sourceType: LeadResearchSourceType
  sourceRetrievedAt: string | null
  sourceCheckStatus: LeadResearchSourceCheckStatus
  sourceCheckResults: LeadResearchSourceCheckResults
  retryCount: number
  retryable: boolean
  summary: string | null
  industry: string | null
  region: string | null
  publicEmail: string | null
  publicPhone: string | null
  instagramUrl: string | null
  sourceProvider: "manual" | "brave_search"
  searchCountry: string | null
  searchCategory: string | null
  searchQuery: string | null
  searchResultTitle: string | null
  searchResultDescription: string | null
  fitScore: number | null
  sponsorshipPotential: number | null
  barterPotential: number | null
  cashPotential: number | null
  advertisingFit: number | null
  geographicCoverage: string | null
  fitRationale: string | null
  evidence: LeadResearchEvidence[]
  proposalDraft: string | null
  emailDraft: string | null
  telegramDraft: string | null
  status: LeadResearchStatus
  errorMessage: string | null
  analyzedAt: string | null
  leadProspectId: string | null
  createdAt: string
  updatedAt: string
}

export type LeadHunterCategory = "lingerie" | "intimate" | "cosmetics" | "lifestyle" | "gifts" | "events"
export type LeadHunterCountry = "RU" | "KZ" | "BY" | "AM" | "KG" | "UZ" | "AZ" | "MD" | "TJ"

export type LeadHunterSearchRunView = {
  id: string
  trigger: LeadSearchTrigger
  searchCountry: LeadHunterCountry
  searchCategory: LeadHunterCategory
  query: string
  status: LeadSearchRunStatus
  requestedCount: number
  discoveredCount: number
  duplicateCount: number
  telegramLinkCount: number
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

export type LeadResearchOverview = {
  candidates: LeadResearchCandidateView[]
  searchRuns: LeadHunterSearchRunView[]
  settings: {
    dailySearchEnabled: boolean
    telegramDiscoveryEnabled: boolean
    searchCountries: LeadHunterCountry[]
    searchCategories: LeadHunterCategory[]
  }
  stats: {
    queued: number
    analyzed: number
    promising: number
    recentPriority: number
    proposals: number
  }
  usageLast24Hours: number
}

export type LeadResearchSourceType = "company_site" | "licensed_directory"

export type LeadResearchStatus = "pending" | "analyzing" | "analyzed" | "saved" | "rejected" | "failed"

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
  summary: string | null
  industry: string | null
  region: string | null
  fitScore: number | null
  fitRationale: string | null
  evidence: LeadResearchEvidence[]
  proposalDraft: string | null
  status: LeadResearchStatus
  errorMessage: string | null
  analyzedAt: string | null
  leadProspectId: string | null
  createdAt: string
  updatedAt: string
}

export type LeadResearchOverview = {
  candidates: LeadResearchCandidateView[]
  stats: {
    queued: number
    analyzed: number
    promising: number
    proposals: number
  }
  usageLast24Hours: number
}

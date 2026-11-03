import type { Metadata } from "next"
import { LeadHunter } from "@/components/lead-hunter"
import { getLeadHunterData, getLeadResearchData, requireCurrentUser } from "@/lib/crm/queries"

export const metadata: Metadata = {
  title: "Поиск лидов",
  description: "Ручная проверка потенциальных рекламодателей по официальным и разрешённым источникам в DESIRE CRM.",
}

export const maxDuration = 120

export default async function LeadsPage() {
  const user = await requireCurrentUser()
  const [{ leads, dailyTarget }, research] = await Promise.all([
    getLeadHunterData(user.id),
    getLeadResearchData(user.id),
  ])
  return <LeadHunter leads={leads} dailyTarget={dailyTarget} research={research} />
}

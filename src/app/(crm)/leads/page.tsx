import type { Metadata } from "next"
import { LeadHunter } from "@/components/lead-hunter"
import { getLeadHunterData, requireCurrentUser } from "@/lib/crm/queries"

export const metadata: Metadata = {
  title: "Поиск лидов",
  description: "Ручной сбор и квалификация рекламодателей по проверенным первоисточникам в DESIRE CRM.",
}

export default async function LeadsPage() {
  const user = await requireCurrentUser()
  const { leads, dailyTarget } = await getLeadHunterData(user.id)
  return <LeadHunter leads={leads} dailyTarget={dailyTarget} />
}

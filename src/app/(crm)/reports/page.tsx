import { Reports } from "@/components/reports"
import { getReportData, requireCurrentUser } from "@/lib/crm/queries"

export default async function ReportsPage() {
  const user = await requireCurrentUser()
  const data = await getReportData(user.id)
  return <Reports data={data} />
}

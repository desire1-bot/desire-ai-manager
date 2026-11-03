import { Overview } from "@/components/overview"
import { getDashboardData, requireCurrentUser } from "@/lib/crm/queries"

export default async function DashboardPage() {
  const user = await requireCurrentUser()
  const data = await getDashboardData(user.id)
  return <Overview data={data} name={user.name} />
}

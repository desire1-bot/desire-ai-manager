import { EntityManager } from "@/components/entity-manager"
import { getCompanies, requireCurrentUser } from "@/lib/crm/queries"

export default async function CompaniesPage() {
  const user = await requireCurrentUser()
  const rows = await getCompanies(user.id)
  const records = rows.map((company) => ({
    id: company.id,
    title: company.name,
    subtitle: company.domain,
    meta: `${company.contactCount} контактов${company.industry ? ` · ${company.industry}` : ""}`,
  }))
  return <EntityManager kind="companies" records={records} />
}

import { EntityManager } from "@/components/entity-manager"
import { getCompanies, getContacts, getDeals, requireCurrentUser } from "@/lib/crm/queries"

export default async function DealsPage() {
  const user = await requireCurrentUser()
  const [rows, companyRows, contactRows] = await Promise.all([getDeals(user.id), getCompanies(user.id), getContacts(user.id)])
  const records = rows.map((deal) => ({
    id: deal.id,
    title: deal.title,
    subtitle: deal.companyName || [deal.contactFirstName, deal.contactLastName].filter(Boolean).join(" ") || "Без компании",
    amount: deal.value,
    status: deal.stage,
    date: deal.expectedCloseDate ? `${deal.expectedCloseDate}T12:00:00` : null,
  }))
  return <EntityManager kind="deals" records={records} companies={companyRows.map(({ id, name }) => ({ id, name }))} contacts={contactRows.map((contact) => ({ id: contact.id, name: `${contact.firstName} ${contact.lastName}` }))} />
}

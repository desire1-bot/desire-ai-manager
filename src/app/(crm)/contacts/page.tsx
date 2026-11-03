import { EntityManager } from "@/components/entity-manager"
import { getCompanies, getContacts, requireCurrentUser } from "@/lib/crm/queries"

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const [{ new: newContact }, user] = await Promise.all([searchParams, requireCurrentUser()])
  const [rows, companyRows] = await Promise.all([getContacts(user.id), getCompanies(user.id)])
  const records = rows.map((contact) => ({
    id: contact.id,
    title: `${contact.firstName} ${contact.lastName}`,
    subtitle: contact.email || contact.phone || contact.title,
    meta: contact.companyName,
    status: contact.status,
  }))
  return <EntityManager key={newContact === "1" ? "new-contact" : "contacts"} kind="contacts" records={records} companies={companyRows.map(({ id, name }) => ({ id, name }))} defaultOpen={newContact === "1"} />
}

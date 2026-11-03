import { EntityManager } from "@/components/entity-manager"
import { getTasks, requireCurrentUser } from "@/lib/crm/queries"

export default async function TasksPage() {
  const user = await requireCurrentUser()
  const rows = await getTasks(user.id)
  const records = rows.map((task) => ({
    id: task.id,
    title: task.title,
    subtitle: task.description || [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ") || task.dealTitle || null,
    status: task.status,
    priority: task.priority,
    date: task.dueDate,
  }))
  return <EntityManager kind="tasks" records={records} />
}

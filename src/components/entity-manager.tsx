"use client"

import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Check, Plus, Search, Trash2, X } from "lucide-react"
import { createCompany, createContact, createDeal, createTask, deleteCrmRecord, updateDealStage, updateTaskStatus } from "@/app/actions/crm"

export type EntityKind = "contacts" | "companies" | "deals" | "tasks"
export type EntityRecord = {
  id: string
  title: string
  subtitle?: string | null
  meta?: string | null
  status?: string | null
  amount?: number
  date?: string | null
  priority?: string | null
}
type Option = { id: string; name: string }
type EntityManagerProps = { kind: EntityKind; records: EntityRecord[]; companies?: Option[]; contacts?: Option[]; defaultOpen?: boolean }

const stages = [
  { value: "qualification", label: "Квалификация" },
  { value: "proposal", label: "Предложение" },
  { value: "negotiation", label: "Переговоры" },
  { value: "won", label: "Выиграно" },
  { value: "lost", label: "Закрыто" },
] as const
const currency = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 })
const kindCopy: Record<EntityKind, { title: string; singular: string; description: string }> = {
  contacts: { title: "Контакты", singular: "контакт", description: "Люди, с которыми строятся ваши отношения и сделки." },
  companies: { title: "Компании", singular: "компанию", description: "Организации и клиенты, с которыми работает команда." },
  deals: { title: "Сделки", singular: "сделку", description: "Воронка продаж и ожидаемая выручка по этапам." },
  tasks: { title: "Задачи", singular: "задачу", description: "Напоминания и следующие шаги по работе с клиентами." },
}
const statusLabels: Record<string, string> = { lead: "Новый контакт", active: "Активный", customer: "Клиент", open: "В работе", done: "Выполнено", low: "Низкий", medium: "Обычный", high: "Высокий" }

function shortDate(value?: string | null) {
  if (!value) return "Без срока"
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value))
}

export function EntityManager({ kind, records, companies = [], contacts = [], defaultOpen = false }: EntityManagerProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(defaultOpen)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const copy = kindCopy[kind]
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU")
    if (!query) return records
    return records.filter((record) => [record.title, record.subtitle, record.meta, record.status].some((value) => value?.toLocaleLowerCase("ru-RU").includes(query)))
  }, [records, search])

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const values = Object.fromEntries(formData.entries())
    setPending(true)
    setError("")
    try {
      const response = kind === "contacts" ? await createContact(values)
        : kind === "companies" ? await createCompany(values)
        : kind === "deals" ? await createDeal(values)
        : await createTask(values)
      if (!response.ok) {
        setError(response.error)
        return
      }
      setShowForm(false)
      form.reset()
      router.refresh()
    } catch {
      setError("Не удалось сохранить запись. Попробуйте ещё раз.")
    } finally {
      setPending(false)
    }
  }

  async function removeRecord(id: string) {
    if (!window.confirm("Удалить запись? Это действие нельзя отменить.")) return
    const recordKind = kind === "contacts" ? "contact" : kind === "companies" ? "company" : kind === "deals" ? "deal" : "task"
    await deleteCrmRecord(recordKind, id)
    router.refresh()
  }

  async function toggleTask(record: EntityRecord) {
    await updateTaskStatus(record.id, record.status === "done" ? "open" : "done")
    router.refresh()
  }

  async function changeStage(id: string, stage: (typeof stages)[number]["value"]) {
    await updateDealStage(id, stage)
    router.refresh()
  }

  return (
    <>
      <section className="page-heading">
        <div><span className="eyebrow">КЛИЕНТСКАЯ БАЗА</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
        <button type="button" className="primary-button" onClick={() => { setShowForm((visible) => !visible); setError("") }} aria-expanded={showForm}>
          {showForm ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{showForm ? "Закрыть" : `Добавить ${copy.singular}`}
        </button>
      </section>
      <section className="card entity-card">
        {showForm && <CreateForm kind={kind} companies={companies} contacts={contacts} onSubmit={submitForm} onCancel={() => setShowForm(false)} pending={pending} error={error} />}
        <div className="entity-toolbar">
          <div><strong className="record-count">{filtered.length} {filtered.length === 1 ? "запись" : "записей"}</strong><span className="toolbar-hint"> в разделе</span></div>
          <label className="search-wrap"><Search aria-hidden="true" /><span className="sr-only">Поиск по разделу</span><input className="search-field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Найти ${copy.title.toLocaleLowerCase("ru-RU")}`} /></label>
        </div>
        {kind === "deals" ? <DealBoard records={filtered} onChange={changeStage} onDelete={removeRecord} /> : kind === "tasks" ? <TaskList records={filtered} onToggle={toggleTask} onDelete={removeRecord} /> : <RecordList kind={kind} records={filtered} onDelete={removeRecord} />}
      </section>
    </>
  )
}

function CreateForm({ kind, companies, contacts, onSubmit, onCancel, pending, error }: {
  kind: EntityKind; companies: Option[]; contacts: Option[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void; pending: boolean; error: string
}) {
  return (
    <form className="entity-form" onSubmit={onSubmit}>
      {kind === "contacts" && <>
        <label>Имя<input name="firstName" placeholder="Имя" autoComplete="given-name" required maxLength={80} /></label>
        <label>Фамилия<input name="lastName" placeholder="Фамилия" autoComplete="family-name" required maxLength={80} /></label>
        <label>Электронная почта<input name="email" type="email" placeholder="name@company.ru" autoComplete="email" maxLength={254} /></label>
        <label>Телефон<input name="phone" type="tel" placeholder="+7 900 000-00-00" autoComplete="tel" maxLength={40} /></label>
        <label>Должность<input name="title" placeholder="Например, директор" maxLength={100} /></label>
        <label>Компания<select name="companyId" defaultValue=""><option value="">Без компании</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      </>}
      {kind === "companies" && <>
        <label>Название<input name="name" placeholder="Название компании" required maxLength={160} /></label>
        <label>Сайт<input name="domain" placeholder="company.ru" maxLength={160} /></label>
        <label>Отрасль<input name="industry" placeholder="Например, технологии" maxLength={100} /></label>
      </>}
      {kind === "deals" && <>
        <label>Название сделки<input name="title" placeholder="Например, годовой контракт" required maxLength={160} /></label>
        <label>Сумма, ₽<input name="value" type="number" min="0" step="1000" defaultValue="0" required /></label>
        <label>Этап<select name="stage" defaultValue="qualification">{stages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>
        <label>Дата закрытия<input name="expectedCloseDate" type="date" /></label>
        <label>Компания<select name="companyId" defaultValue=""><option value="">Не выбрана</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label>Контакт<select name="contactId" defaultValue=""><option value="">Не выбран</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
      </>}
      {kind === "tasks" && <>
        <label>Что нужно сделать<input name="title" placeholder="Например, связаться с клиентом" required maxLength={160} /></label>
        <label>Срок<input name="dueDate" type="datetime-local" /></label>
        <label>Приоритет<select name="priority" defaultValue="medium"><option value="low">Низкий</option><option value="medium">Обычный</option><option value="high">Высокий</option></select></label>
        <label>Комментарий<input name="description" placeholder="Короткая заметка" maxLength={1000} /></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button><button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>Отмена</button></div>
    </form>
  )
}

function RecordList({ kind, records, onDelete }: { kind: "contacts" | "companies"; records: EntityRecord[]; onDelete: (id: string) => void }) {
  if (!records.length) return <div className="empty-state"><div><strong>Пока здесь пусто</strong><span>Создайте первую запись или измените поисковый запрос.</span></div></div>
  return <div className="entity-list" role="list">
    <div className="entity-row entity-row-heading" aria-hidden="true"><div className="entity-cell">{kind === "contacts" ? "Контакт" : "Компания"}</div><div className="entity-cell">Связь</div><div className="entity-cell">Статус</div><div /></div>
    {records.map((record) => <div className="entity-row" role="listitem" key={record.id}>
      <div className="entity-cell"><strong>{record.title}</strong><span>{record.subtitle || "Нет дополнительных данных"}</span></div>
      <div className="entity-cell"><strong>{record.meta || "—"}</strong><span>{kind === "contacts" ? "Компания" : "Отрасль / контакты"}</span></div>
      <div className="entity-cell"><span className="status-badge" data-status={record.status}>{statusLabels[record.status ?? ""] ?? record.status ?? "В базе"}</span></div>
      <div className="entity-actions"><button type="button" className="text-button delete-button" onClick={() => onDelete(record.id)} aria-label={`Удалить: ${record.title}`}><Trash2 aria-hidden="true" /><span>Удалить</span></button></div>
    </div>)}
  </div>
}

function DealBoard({ records, onChange, onDelete }: { records: EntityRecord[]; onChange: (id: string, stage: (typeof stages)[number]["value"]) => void; onDelete: (id: string) => void }) {
  return <div className="deal-grid" aria-label="Воронка сделок">
    {stages.map((stage) => {
      const stageRecords = records.filter((record) => record.status === stage.value)
      return <section className="deal-column" key={stage.value} aria-label={stage.label}>
        <h2 className="deal-column-heading"><span>{stage.label}</span><span className="deal-count">{stageRecords.length}</span></h2>
        {stageRecords.map((record) => <article className="deal-card" key={record.id}>
          <strong>{record.title}</strong><p>{record.subtitle || "Без компании"}</p><div className="deal-card-bottom"><b>{currency.format(record.amount ?? 0)}</b><button type="button" className="deal-delete" onClick={() => onDelete(record.id)} aria-label={`Удалить сделку: ${record.title}`}><Trash2 aria-hidden="true" /></button></div>
          {record.date && <span className="deal-date">До {shortDate(record.date)}</span>}
          <label className="sr-only" htmlFor={`stage-${record.id}`}>Этап сделки: {record.title}</label><select id={`stage-${record.id}`} value={record.status ?? "qualification"} onChange={(event) => onChange(record.id, event.target.value as (typeof stages)[number]["value"])}>{stages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </article>)}
        {!stageRecords.length && <p className="column-empty">Нет сделок</p>}
      </section>
    })}
  </div>
}

function TaskList({ records, onToggle, onDelete }: { records: EntityRecord[]; onToggle: (record: EntityRecord) => void; onDelete: (id: string) => void }) {
  if (!records.length) return <div className="empty-state"><div><strong>Пока здесь пусто</strong><span>Создайте задачу, чтобы помнить о следующем шаге.</span></div></div>
  return <div className="task-list">
    {records.map((record) => <article className={`task-row${record.status === "done" ? " task-row-done" : ""}`} key={record.id}>
      <button type="button" className="task-check" data-done={record.status === "done"} onClick={() => onToggle(record)} aria-label={record.status === "done" ? `Вернуть задачу ${record.title} в работу` : `Отметить задачу ${record.title} выполненной`}>{record.status === "done" && <Check aria-hidden="true" />}</button>
      <div className="task-content"><strong>{record.title}</strong><span>{record.subtitle || "Без описания"}</span></div>
      <span className="status-badge" data-status={record.priority}>{statusLabels[record.priority ?? ""] ?? "Обычный"}</span>
      <span className="task-date">{shortDate(record.date)}</span>
      <button type="button" className="deal-delete" onClick={() => onDelete(record.id)} aria-label={`Удалить задачу: ${record.title}`}><Trash2 aria-hidden="true" /></button>
    </article>)}
  </div>
}

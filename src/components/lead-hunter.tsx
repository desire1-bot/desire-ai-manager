"use client"

import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowUpRight,
  Building2,
  Check,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from "lucide-react"
import {
  convertLeadToCompany,
  createLeadProspect,
  deleteLeadProspect,
  saveLeadHunterTarget,
  updateLeadScore,
  updateLeadStatus,
} from "@/app/actions/leads"

type LeadStatus = "new" | "verified" | "qualified" | "rejected" | "converted"
type SourceType = "company_site" | "licensed_directory"
export type LeadProspect = {
  id: string
  companyName: string
  website: string | null
  websiteDomain: string | null
  industry: string | null
  region: string | null
  publicEmail: string | null
  publicPhone: string | null
  publicTelegramUrl: string | null
  sourceUrl: string
  sourceType: SourceType
  status: LeadStatus
  potentialScore: number
  notes: string | null
  discoveredAt: string
  verifiedAt: string | null
  companyId: string | null
}

type Props = { leads: LeadProspect[]; dailyTarget: number }
type Filter = "all" | LeadStatus

const statusLabels: Record<LeadStatus, string> = {
  new: "Новый",
  verified: "Проверен",
  qualified: "Квалифицирован",
  rejected: "Отклонён",
  converted: "В CRM",
}
const sourceLabels: Record<SourceType, string> = {
  company_site: "Сайт компании",
  licensed_directory: "Лицензированный каталог",
}
const filterOptions: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "verified", label: "Проверены" },
  { value: "qualified", label: "В работе" },
  { value: "converted", label: "В CRM" },
  { value: "rejected", label: "Отклонены" },
]
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" })

function formatDate(value: string) {
  return dateFormat.format(new Date(value))
}

export function LeadHunter({ leads, dailyTarget }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [target, setTarget] = useState(String(dailyTarget))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  const today = new Date().toDateString()
  const todayCount = leads.filter((lead) => new Date(lead.discoveredAt).toDateString() === today).length
  const verifiedCount = leads.filter((lead) => ["verified", "qualified", "converted"].includes(lead.status)).length
  const highValueCount = leads.filter((lead) => lead.potentialScore >= 80 && lead.status !== "rejected").length
  const progress = Math.min(100, Math.round((todayCount / dailyTarget) * 100))
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU")
    return leads.filter((lead) => {
      const matchesStatus = filter === "all" || lead.status === filter
      const matchesSearch = !query || [lead.companyName, lead.websiteDomain, lead.industry, lead.region, lead.publicEmail]
        .some((value) => value?.toLocaleLowerCase("ru-RU").includes(query))
      return matchesStatus && matchesSearch
    })
  }, [filter, leads, search])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    setPending(true)
    setNotice(null)
    try {
      const result = await createLeadProspect(values)
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      form.reset()
      setShowForm(false)
      setNotice({ text: "Карточка сохранена. Перед квалификацией откройте первоисточник и сверьте данные." })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось сохранить карточку. Попробуйте ещё раз.", error: true })
    } finally {
      setPending(false)
    }
  }

  async function handleTargetSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      const result = await saveLeadHunterTarget(target)
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      setNotice({ text: "Дневная цель обновлена." })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось обновить цель.", error: true })
    } finally {
      setPending(false)
    }
  }

  async function runLeadAction(id: string, action: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    setPendingId(id)
    setNotice(null)
    try {
      const result = await action()
      if (!result.ok) {
        setNotice({ text: result.error ?? "Не удалось выполнить действие.", error: true })
        return
      }
      setNotice({ text: successText })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось выполнить действие. Попробуйте ещё раз.", error: true })
    } finally {
      setPendingId(null)
    }
  }

  async function handleDelete(id: string, companyName: string) {
    if (!window.confirm(`Удалить карточку «${companyName}»?`)) return
    await runLeadAction(id, () => deleteLeadProspect(id), "Карточка удалена.")
  }

  return (
    <div className="lead-hunter">
      <section className="page-heading">
        <div>
          <span className="eyebrow">ПЕРВОИСТОЧНИКИ И ПРОВЕРЕННЫЕ ДАННЫЕ</span>
          <h1>Поиск лидов</h1>
          <p>Собирайте карточки рекламодателей вручную, проверяя каждый контакт на сайте компании или в лицензированном каталоге.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => { setShowForm((value) => !value); setNotice(null) }} aria-expanded={showForm}>
          {showForm ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {showForm ? "Закрыть" : "Добавить компанию"}
        </button>
      </section>

      <div className="lead-compliance" role="note">
        <ShieldCheck aria-hidden="true" />
        <span><strong>Только проверяемые источники.</strong> Внешний поисковый API и автоматический сбор не подключены. Публичный рабочий email или телефон сами по себе не означают согласие на рекламную рассылку.</span>
      </div>

      <section className="metric-grid" aria-label="Показатели Lead Hunter">
        <article className="metric-card">
          <div className="metric-card-top"><span className="metric-label">Всего компаний</span><span className="metric-icon"><Building2 aria-hidden="true" /></span></div>
          <strong className="metric-value">{leads.length}</strong><span className="metric-note">Сохранено в вашей CRM</span>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span className="metric-label">Проверено</span><span className="metric-icon"><ShieldCheck aria-hidden="true" /></span></div>
          <strong className="metric-value">{verifiedCount}</strong><span className="metric-note">Есть отметка проверки сайта</span>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span className="metric-label">Высокий потенциал</span><span className="metric-icon"><Target aria-hidden="true" /></span></div>
          <strong className="metric-value">{highValueCount}</strong><span className="metric-note">Внутренняя оценка от 80 баллов</span>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span className="metric-label">Найдено сегодня</span><span className="metric-icon"><Check aria-hidden="true" /></span></div>
          <strong className="metric-value">{todayCount}<span className="metric-target"> / {dailyTarget}</span></strong>
          <span className="metric-note">Ручная цель на день</span><div className="lead-progress" aria-label={`Выполнено ${progress}% дневной цели`}><span style={{ width: `${progress}%` }} /></div>
        </article>
      </section>

      <section className="lead-controls" aria-label="Настройка дневной цели">
        <div className="lead-target-copy"><Target aria-hidden="true" /><div><strong>Дневная цель поиска</strong><span>Ориентир для ручного поиска и проверки; автоматический сбор не запускается.</span></div></div>
        <form className="lead-target-form" onSubmit={handleTargetSave}>
          <label htmlFor="lead-daily-target">Цель на день
            <select id="lead-daily-target" value={target} onChange={(event) => setTarget(event.target.value)}>
              {[20, 25, 30, 35, 40, 45, 50].map((value) => <option key={value} value={value}>{value} компаний</option>)}
            </select>
          </label>
          <button type="submit" className="secondary-button" disabled={pending}>Сохранить</button>
        </form>
      </section>

      {notice && <p className="lead-notice" data-tone={notice.error ? "error" : "success"} role="status">{notice.text}</p>}

      {showForm && <form className="lead-form" onSubmit={handleCreate}>
        <div className="lead-form-heading"><div><h2>Новая карточка рекламодателя</h2><p>Добавляйте только сведения, опубликованные компанией или разрешённым источником.</p></div></div>
        <div className="lead-form-grid">
          <label>Название компании *<input name="companyName" required maxLength={160} placeholder="Например, ООО «Пример»" autoComplete="organization" /></label>
          <label>Сайт компании<input name="website" type="url" maxLength={2048} placeholder="https://company.ru" autoComplete="url" /></label>
          <label>Отрасль<input name="industry" maxLength={100} placeholder="Например, производство" /></label>
          <label>Регион<input name="region" maxLength={100} placeholder="Город или регион" autoComplete="address-level1" /></label>
          <label>Публичный рабочий email<input name="publicEmail" type="email" maxLength={254} placeholder="info@company.ru" autoComplete="email" /></label>
          <label>Публичный рабочий телефон<input name="publicPhone" type="tel" maxLength={40} placeholder="+7 900 000-00-00" autoComplete="tel" /></label>
          <label>Официальный Telegram компании<input name="publicTelegramUrl" type="url" maxLength={2048} placeholder="https://t.me/company" /></label>
          <label>Тип первоисточника<select name="sourceType" defaultValue="company_site"><option value="company_site">Официальный сайт компании</option><option value="licensed_directory">Лицензированный каталог</option></select></label>
          <label>Потенциал рекламодателя, 0–100<input name="potentialScore" type="number" min="0" max="100" step="1" defaultValue="50" required /><span className="lead-note">Внутренняя оценка команды, не внешние данные.</span></label>
          <label className="lead-field-wide">URL страницы-первоисточника *<input name="sourceUrl" type="url" required maxLength={2048} placeholder="https://company.ru/contacts" /></label>
          <label className="lead-field-wide">Заметка<textarea name="notes" maxLength={1000} placeholder="Что важно для проверки или будущего предложения?" /></label>
          <label className="lead-check-label lead-field-wide"><input name="verified" type="checkbox" /><span>Я открыл первоисточник и сверил сведения в этой карточке</span></label>
        </div>
        <p className="lead-note">Сохраняются дата обнаружения и URL первоисточника. Добавление компании в CRM доступно после ручной проверки.</p>
        <div className="lead-form-actions"><button type="submit" className="primary-button" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить карточку"}</button><button type="button" className="secondary-button" onClick={() => setShowForm(false)} disabled={pending}>Отмена</button></div>
      </form>}

      <section className="lead-toolbar" aria-label="Поиск и фильтры лидов">
        <div className="lead-filter-list" role="group" aria-label="Фильтр по статусу">
          {filterOptions.map((option) => {
            const count = option.value === "all" ? leads.length : leads.filter((lead) => lead.status === option.value).length
            return <button key={option.value} type="button" className="lead-filter" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}<span className="lead-filter-count">{count}</span></button>
          })}
        </div>
        <label className="lead-search"><Search aria-hidden="true" /><span className="sr-only">Поиск по компаниям</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Компания, отрасль, email" /></label>
      </section>

      {filtered.length ? <div className="lead-cards" role="list" aria-label="Карточки лидов">
        {filtered.map((lead) => <LeadCard key={lead.id} lead={lead} pending={pendingId === lead.id} onAction={runLeadAction} onDelete={handleDelete} />)}
      </div> : <div className="lead-empty"><div><Target aria-hidden="true" /><strong>{leads.length ? "Ничего не найдено" : "Карточек пока нет"}</strong><p>{leads.length ? "Попробуйте изменить поиск или фильтр." : "Добавьте компанию, откройте её официальный сайт и сохраните ссылку на конкретный первоисточник."}</p></div></div>}
    </div>
  )
}

function LeadCard({ lead, pending, onAction, onDelete }: {
  lead: LeadProspect
  pending: boolean
  onAction: (id: string, action: () => Promise<{ ok: boolean; error?: string }>, successText: string) => void
  onDelete: (id: string, companyName: string) => void
}) {
  const [score, setScore] = useState(String(lead.potentialScore))
  const [scorePending, setScorePending] = useState(false)
  const [scoreMessage, setScoreMessage] = useState("")
  const router = useRouter()

  async function saveScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setScorePending(true)
    setScoreMessage("")
    try {
      const result = await updateLeadScore(lead.id, score)
      if (!result.ok) {
        setScoreMessage(result.error ?? "Не удалось сохранить оценку.")
        return
      }
      router.refresh()
    } catch {
      setScoreMessage("Не удалось сохранить оценку.")
    } finally {
      setScorePending(false)
    }
  }

  return (
    <article className="lead-card" role="listitem">
      <div className="lead-card-top">
        <div className="lead-company"><h2>{lead.companyName}</h2><p>{[lead.industry, lead.region].filter(Boolean).join(" · ") || lead.websiteDomain || "Компания без категории"}</p></div>
        <span className="lead-status" data-status={lead.status}>{statusLabels[lead.status]}</span>
      </div>
      <div className="lead-card-grid">
        {lead.website && <div className="lead-detail"><Globe aria-hidden="true" /><a href={lead.website} target="_blank" rel="noopener noreferrer">{lead.websiteDomain ?? lead.website}</a></div>}
        {lead.publicEmail && <div className="lead-detail"><Mail aria-hidden="true" /><a href={`mailto:${lead.publicEmail}`}>{lead.publicEmail}</a></div>}
        {lead.publicPhone && <div className="lead-detail"><Phone aria-hidden="true" /><a href={`tel:${lead.publicPhone}`}>{lead.publicPhone}</a></div>}
        {lead.region && <div className="lead-detail"><MapPin aria-hidden="true" /><span>{lead.region}</span></div>}
        {lead.publicTelegramUrl && <div className="lead-detail"><ArrowUpRight aria-hidden="true" /><a href={lead.publicTelegramUrl} target="_blank" rel="noopener noreferrer">Telegram компании</a></div>}
      </div>
      {lead.notes && <p className="lead-note">{lead.notes}</p>}
      <div className="lead-card-meta"><a className="lead-source-link" href={lead.sourceUrl} target="_blank" rel="noopener noreferrer">Первоисточник <ExternalLink aria-hidden="true" /></a><span className="lead-note">{sourceLabels[lead.sourceType]}</span><time className="lead-date" dateTime={lead.discoveredAt}>Обнаружена {formatDate(lead.discoveredAt)}</time></div>
      <div className="lead-score-row"><span className="lead-score-label">Потенциал рекламодателя</span><div className="lead-score-value"><Target aria-hidden="true" /><span>{lead.potentialScore}/100</span><form className="lead-score-editor" onSubmit={saveScore}><label className="sr-only" htmlFor={`score-${lead.id}`}>Изменить оценку для {lead.companyName}</label><input id={`score-${lead.id}`} value={score} onChange={(event) => setScore(event.target.value)} type="number" min="0" max="100" /><button type="submit" disabled={scorePending}>Ок</button></form></div></div>
      {scoreMessage && <p className="lead-note" role="status">{scoreMessage}</p>}
      <div className="lead-card-actions">
        {lead.status === "new" && <button type="button" className="secondary-button" disabled={pending} onClick={() => onAction(lead.id, () => updateLeadStatus(lead.id, "verified"), "Источник отмечен как проверенный.")}><ShieldCheck aria-hidden="true" />Проверить источник</button>}
        {lead.status === "verified" && <button type="button" className="secondary-button" disabled={pending} onClick={() => onAction(lead.id, () => updateLeadStatus(lead.id, "qualified"), "Лид квалифицирован.")}><Check aria-hidden="true" />Квалифицировать</button>}
        {["verified", "qualified"].includes(lead.status) && <button type="button" className="primary-button" disabled={pending} onClick={() => onAction(lead.id, () => convertLeadToCompany(lead.id), "Компания добавлена в CRM.")}><Building2 aria-hidden="true" />Добавить в CRM</button>}
        {lead.status === "rejected" && <button type="button" className="secondary-button" disabled={pending} onClick={() => onAction(lead.id, () => updateLeadStatus(lead.id, "new"), "Карточка возвращена в новые.")}>Вернуть в новые</button>}
        {lead.status !== "rejected" && lead.status !== "converted" && <button type="button" className="text-button" disabled={pending} onClick={() => onAction(lead.id, () => updateLeadStatus(lead.id, "rejected"), "Карточка отклонена.")}>Отклонить</button>}
        {lead.status === "converted" && <Link className="secondary-button" href="/companies">Открыть компании <ArrowUpRight aria-hidden="true" /></Link>}
        <button type="button" className="lead-delete" disabled={pending} onClick={() => onDelete(lead.id, lead.companyName)} aria-label={`Удалить карточку ${lead.companyName}`}><Trash2 aria-hidden="true" /></button>
      </div>
    </article>
  )
}

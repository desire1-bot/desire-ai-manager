"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  FileText,
  Globe2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react"
import {
  analyzeLeadResearchCandidate,
  createLeadResearchRun,
  rejectLeadResearchCandidate,
  saveLeadResearchCandidate,
  saveLeadResearchDraft,
} from "@/app/actions/lead-research"
import type {
  LeadResearchCandidateView,
  LeadResearchOverview,
  LeadResearchSourceType,
} from "@/lib/lead-research-types"

const statusLabels = {
  pending: "Ожидание",
  analyzing: "Анализ",
  analyzed: "Успешно",
  saved: "Сохранён в Lead Hunter",
  rejected: "Отклонён",
  failed: "Ошибка",
} as const

const sourceLabels: Record<LeadResearchSourceType, string> = {
  company_site: "Сайт компании",
  licensed_directory: "Разрешённый источник",
}

const evidenceFieldLabels = {
  companyName: "Название",
  industry: "Отрасль",
  region: "Регион",
  summary: "Описание",
  fitRationale: "Оценка соответствия",
} as const

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const INPUT_MAX_BYTES = 50_000

export function LeadResearchPanel({ research, dailyTarget }: { research: LeadResearchOverview; dailyTarget: number }) {
  const router = useRouter()
  const [input, setInput] = useState("")
  const [sourceType, setSourceType] = useState<LeadResearchSourceType>("company_site")
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const remaining = Math.max(0, dailyTarget - research.usageLast24Hours)

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      const result = await createLeadResearchRun({ content: input, sourceType, confirmed })
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      setNotice({
        text: result.createdCount
          ? `Добавлено в очередь: ${result.createdCount}. Дубликатов пропущено: ${result.duplicateCount}. Анализ запускается только вручную.`
          : `Новых компаний нет. Дубликатов пропущено: ${result.duplicateCount}.`,
      })
      if (result.createdCount) {
        setInput("")
        setConfirmed(false)
        router.refresh()
      }
    } catch {
      setNotice({ text: "Не удалось создать очередь. Попробуйте ещё раз.", error: true })
    } finally {
      setPending(false)
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    if (file.size > INPUT_MAX_BYTES) {
      setNotice({ text: "CSV больше 50 КБ. Выберите файл меньшего размера.", error: true })
      event.currentTarget.value = ""
      return
    }
    try {
      setInput(await file.text())
      setNotice(null)
    } catch {
      setNotice({ text: "Не удалось прочитать CSV-файл.", error: true })
    }
  }

  return (
    <section className="research-panel" aria-labelledby="research-title">
      <div className="research-header">
        <div>
          <span className="eyebrow">РУЧНОЙ ПОИСК · ПРОВЕРЯЕМЫЕ ИСТОЧНИКИ</span>
          <h2 id="research-title"><Sparkles aria-hidden="true" />AI-проверка рекламодателей</h2>
          <p>Добавьте официальные сайты компаний или материалы из источника, на использование которого у вас есть разрешение. Поиск, обход ограничений и автоматический сбор отключены.</p>
        </div>
        <div className="research-limit"><Clock3 aria-hidden="true" /><span>За последние 24 часа<br /><strong>{research.usageLast24Hours} / {dailyTarget}</strong> компаний</span></div>
      </div>

      <div className="research-stats" aria-label="Статистика AI Research">
        <ResearchStat icon={<Clock3 aria-hidden="true" />} label="В очереди" value={research.stats.queued} />
        <ResearchStat icon={<BadgeCheck aria-hidden="true" />} label="Проверено AI" value={research.stats.analyzed} />
        <ResearchStat icon={<ShieldCheck aria-hidden="true" />} label="Оценка 80+" value={research.stats.promising} />
        <ResearchStat icon={<FileText aria-hidden="true" />} label="Черновики" value={research.stats.proposals} />
      </div>

      <form className="research-form" onSubmit={handleImport}>
        <div className="research-form-header">
          <div><h3>Новая очередь</h3><p>До 50 URL за одну загрузку; обрабатывается не больше дневного лимита.</p></div>
          <label className="research-file-button"><Upload aria-hidden="true" />Загрузить CSV<input type="file" accept=".csv,text/csv" onChange={handleFileChange} aria-label="Загрузить CSV-файл со списком компаний" /></label>
        </div>

        <label className="research-input-label" htmlFor="research-input">
          <span>URL по одному на строку или CSV с колонками <code>url</code> и необязательной <code>company_name</code></span>
          <textarea
            id="research-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={INPUT_MAX_BYTES}
            placeholder={'https://company-one.com/\nhttps://company-two.com/\n\nили CSV: url,company_name'}
            rows={4}
            required
          />
        </label>

        <div className="research-form-options">
          <label htmlFor="research-source-type">Тип источника
            <select id="research-source-type" value={sourceType} onChange={(event) => setSourceType(event.target.value as LeadResearchSourceType)}>
              <option value="company_site">Официальный сайт компании</option>
              <option value="licensed_directory">Лицензированный источник</option>
            </select>
          </label>
          <label className="research-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />
            <span>Подтверждаю право на обработку источников. Telegram-URL и Telegram-данные не добавляются.</span>
          </label>
          <button className="primary-button" type="submit" disabled={pending || !confirmed || !input.trim() || remaining === 0}>
            {pending ? <LoaderCircle className="research-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            {pending ? "Создаём очередь…" : "Добавить в очередь"}
          </button>
        </div>
        <p className="research-footnote">Каждый сайт проверяется по DNS, robots.txt, размеру и типу ответа. Email и телефоны удаляются до передачи текста модели. Анализ и предложения остаются черновиками; сообщения не отправляются.</p>
      </form>

      {notice && <p className="research-notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.error && <AlertCircle aria-hidden="true" />}{notice.text}</p>}

      <div className="research-queue-heading"><div><h3>Очередь проверки</h3><p>Анализ запускается отдельно для каждой компании.</p></div><span>{research.candidates.length} карточек</span></div>
      {research.candidates.length ? <div className="research-candidate-list">
        {research.candidates.map((candidate) => <ResearchCandidateCard key={`${candidate.id}-${candidate.updatedAt}`} candidate={candidate} />)}
      </div> : <div className="research-empty"><Globe2 aria-hidden="true" /><strong>Очередь пока пуста</strong><p>Вставьте публичные URL компаний или загрузите CSV, чтобы начать ручную проверку.</p></div>}
    </section>
  )
}

function ResearchStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="research-stat"><span className="research-stat-icon">{icon}</span><span className="research-stat-label">{label}</span><strong>{value}</strong></div>
}

function ResearchCandidateCard({ candidate }: { candidate: LeadResearchCandidateView }) {
  const router = useRouter()
  const [proposal, setProposal] = useState(candidate.proposalDraft ?? "")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)

  async function runAction(action: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await action()
      if (!result.ok) {
        setNotice({ text: result.error ?? "Действие не выполнено.", error: true })
        return
      }
      setNotice({ text: successText })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось выполнить действие. Попробуйте ещё раз.", error: true })
    } finally {
      setBusy(false)
    }
  }

  const displayName = candidate.companyName || candidate.sourceTitle || candidate.websiteDomain
  const isAnalyzed = ["analyzed", "saved"].includes(candidate.status)

  return (
    <article className="research-card">
      <div className="research-card-header">
        <div className="research-card-title">
          <span className="research-source-type">{sourceLabels[candidate.sourceType]}</span>
          <h4>{displayName}</h4>
          <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidate.websiteDomain}<ArrowUpRight aria-hidden="true" /></a>
        </div>
        <span className="research-status" data-status={candidate.status}>
          {candidate.status === "failed" && candidate.retryable ? "Временная ошибка" : statusLabels[candidate.status]}
        </span>
      </div>

      {candidate.status === "pending" && <p className="research-state"><Clock3 aria-hidden="true" />Ожидает запуска. Анализ выполняется только вручную.</p>}
      {candidate.status === "analyzing" && <p className="research-state"><LoaderCircle className="research-spinner" aria-hidden="true" />{candidate.sourceCheckStatus === "passed" ? "Анализируем сохранённый снимок сайта…" : "Проверяем доступ к источнику и анализируем страницу…"}</p>}
      {candidate.status === "failed" && <p className="research-error"><AlertCircle aria-hidden="true" />{candidate.errorMessage ?? "Анализ не завершился."}</p>}
      {candidate.status === "failed" && candidate.retryable && candidate.sourceCheckStatus === "passed" && <p className="research-cache-note" role="status">Источник уже проверен. Повтор использует сохранённый снимок и не запрашивает сайт заново.</p>}
      {candidate.sourceCheckStatus === "passed" && <details className="research-evidence research-source-check">
        <summary>Результаты проверки источника</summary>
        <ul>
          <li>DNS: {candidate.sourceCheckResults.publicDns ? "адрес публичный" : "не подтверждён"}</li>
          <li>robots.txt: {candidate.sourceCheckResults.robots === "allowed" ? "доступ разрешён" : candidate.sourceCheckResults.robots === "not_published" ? "файл не опубликован" : "нет данных"}</li>
          <li>HTTP: {candidate.sourceCheckResults.contentType || "тип не определён"}; {candidate.sourceCheckResults.responseBytes ?? 0} байт; перенаправлений: {candidate.sourceCheckResults.redirectCount ?? 0}</li>
          {candidate.sourceCheckResults.checkedAt && <li>Проверено {dateFormat.format(new Date(candidate.sourceCheckResults.checkedAt))}</li>}
        </ul>
      </details>}

      {isAnalyzed && <>
        <div className="research-analysis-top">
          <div className="research-score"><strong>{candidate.fitScore ?? 0}</strong><span>/ 100</span></div>
          <div className="research-analysis-copy"><span>{[candidate.industry, candidate.region].filter(Boolean).join(" · ") || "Отрасль или регион не подтверждены источником"}</span><p>{candidate.summary}</p></div>
        </div>
        {candidate.fitRationale && <p className="research-rationale"><strong>Почему может подойти</strong>{candidate.fitRationale}</p>}
        {candidate.evidence.length > 0 && <details className="research-evidence">
          <summary>Проверяемые основания · {candidate.evidence.length}</summary>
          <ul>{candidate.evidence.map((item, index) => <li key={`${item.sourceUrl}-${item.field}-${index}`}><span className="research-evidence-field">{evidenceFieldLabels[item.field]}</span><strong>{item.claim}</strong><blockquote>{item.quote}</blockquote><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть источник <ArrowUpRight aria-hidden="true" /></a></li>)}</ul>
        </details>}
        {candidate.sourceRetrievedAt && <p className="research-retrieved">Источник проверен {dateFormat.format(new Date(candidate.sourceRetrievedAt))}</p>}
        <label className="research-proposal-label" htmlFor={`proposal-${candidate.id}`}>Черновик предложения · проверьте и отредактируйте
          <textarea id={`proposal-${candidate.id}`} value={proposal} onChange={(event) => setProposal(event.target.value)} maxLength={3000} rows={5} disabled={candidate.status === "saved"} />
        </label>
      </>}

      {notice && <p className="research-card-notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <div className="research-card-actions">
        {(candidate.status === "pending" || candidate.status === "failed" && candidate.retryable) && <button type="button" className="primary-button" disabled={busy} onClick={() => runAction(() => analyzeLeadResearchCandidate(candidate.id), "AI-анализ завершён. Проверьте вывод и источники.")}>{busy ? <LoaderCircle className="research-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{candidate.status === "failed" ? "Повторить анализ" : "Анализировать сайт"}</button>}
        {candidate.status === "analyzed" && <>
          <button type="button" className="secondary-button" disabled={busy || !proposal.trim()} onClick={() => runAction(() => saveLeadResearchDraft(candidate.id, proposal), "Черновик предложения сохранён.")}>{busy ? "Сохраняем…" : "Сохранить черновик"}</button>
          <button type="button" className="primary-button" disabled={busy || !proposal.trim()} onClick={() => runAction(() => saveLeadResearchCandidate(candidate.id, proposal), "Лид добавлен в Lead Hunter; перед квалификацией проверьте сайт вручную.")}>{busy ? "Сохраняем…" : "Сохранить как лид"}</button>
        </>}
        {candidate.status === "saved" && <span className="research-saved"><BadgeCheck aria-hidden="true" />Лид ожидает ручной проверки в Lead Hunter</span>}
        {candidate.status === "rejected" && <span className="research-saved">Карточка закрыта</span>}
        {["pending", "failed", "analyzed"].includes(candidate.status) && <button type="button" className="research-reject" disabled={busy} onClick={() => runAction(() => rejectLeadResearchCandidate(candidate.id), "Карточка отклонена.")}>Отклонить</button>}
      </div>
    </article>
  )
}

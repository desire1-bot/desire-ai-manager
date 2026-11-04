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
  History,
  LoaderCircle,
  MapPin,
  Search,
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
  startLeadHunterSearch,
} from "@/app/actions/lead-research"
import { saveLeadHunterPreferences } from "@/app/actions/leads"
import { leadHunterCategories, leadHunterCountries } from "@/lib/lead-hunter-options"
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

export function LeadResearchPanel({ research, dailyTarget, telegramConnected }: { research: LeadResearchOverview; dailyTarget: number; telegramConnected: boolean }) {
  const router = useRouter()
  const [input, setInput] = useState("")
  const [sourceType, setSourceType] = useState<LeadResearchSourceType>("company_site")
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [searchPending, setSearchPending] = useState(false)
  const [searchCountries, setSearchCountries] = useState([...research.settings.searchCountries])
  const [searchCategories, setSearchCategories] = useState([...research.settings.searchCategories])
  const [dailySearchEnabled, setDailySearchEnabled] = useState(research.settings.dailySearchEnabled)
  const [telegramDiscoveryEnabled, setTelegramDiscoveryEnabled] = useState(research.settings.telegramDiscoveryEnabled)
  const [searchLimit, setSearchLimit] = useState(String(dailyTarget))
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const remaining = Math.max(0, dailyTarget - research.usageLast24Hours)

  async function handlePreferencesSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setNotice(null)
    try {
      const result = await saveLeadHunterPreferences({ dailySearchEnabled, telegramDiscoveryEnabled, searchCountries, searchCategories })
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      setNotice({ text: dailySearchEnabled ? `Настройки сохранены. Автопоиск запустится в 09:00 по Москве${telegramDiscoveryEnabled ? ", включая публичные каналы Telegram" : ""}.` : "Настройки сохранены. Ежедневный автопоиск выключен." })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось сохранить настройки поиска.", error: true })
    } finally {
      setPending(false)
    }
  }

  async function handleSearchNow() {
    setSearchPending(true)
    setNotice(null)
    try {
      const result = await startLeadHunterSearch({ categories: searchCategories, countries: searchCountries, limit: Number(searchLimit) })
      if (!result.ok) {
        setNotice({ text: result.error ?? "Не удалось запустить поиск.", error: true })
        return
      }
      setNotice({ text: result.message ?? `Найдено новых записей: ${result.discoveredCount}.` })
      router.refresh()
    } catch {
      setNotice({ text: "Не удалось запустить поиск. Проверьте подключение и повторите попытку.", error: true })
    } finally {
      setSearchPending(false)
    }
  }

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
          <span className="eyebrow">BRAVE SEARCH · ОФИЦИАЛЬНЫЕ САЙТЫ · ССЫЛКИ НА КАНАЛЫ</span>
          <h2 id="research-title"><Sparkles aria-hidden="true" />AI-проверка рекламодателей</h2>
          <p>Brave Search собирает сайты компаний для отдельного AI-анализа. Telegram запускается отдельно, только по вашему запросу или включённому расписанию; его публикации оцениваются правилами без передачи текста модели.</p>
        </div>
        <div className="research-limit"><Clock3 aria-hidden="true" /><span>За последние 24 часа<br /><strong>{research.usageLast24Hours} / {dailyTarget}</strong> компаний</span></div>
      </div>

      <div className="research-stats" aria-label="Статистика AI Research">
        <ResearchStat icon={<Clock3 aria-hidden="true" />} label="В очереди" value={research.stats.queued} />
        <ResearchStat icon={<BadgeCheck aria-hidden="true" />} label="Проверено AI" value={research.stats.analyzed} />
        <ResearchStat icon={<ShieldCheck aria-hidden="true" />} label="Оценка 80+" value={research.stats.promising} />
        <ResearchStat icon={<FileText aria-hidden="true" />} label="Черновики" value={research.stats.proposals} />
      </div>

      {research.stats.recentPriority > 0 && <aside className="research-priority-alert" role="status">
        <BadgeCheck aria-hidden="true" /><span><strong>Новые приоритетные рекламодатели</strong>{research.stats.recentPriority} проверенных компаний получили оценку 80+ за последние 24 часа.</span>
      </aside>}

      <form className="research-config" onSubmit={handlePreferencesSave}>
        <div className="research-config-header">
          <div><h3><Search aria-hidden="true" />Поиск по категориям и странам</h3><p>Реальные результаты Brave Search API; до 10 запросов за запуск.</p></div>
          <div className="research-schedule-toggles">
            <label className="research-schedule-toggle">
              <input type="checkbox" checked={dailySearchEnabled} onChange={(event) => setDailySearchEnabled(event.target.checked)} />
              <span><strong>Ежедневно</strong><small>09:00 · Москва</small></span>
            </label>
            <label className="research-schedule-toggle research-telegram-toggle">
              <input type="checkbox" checked={telegramDiscoveryEnabled} disabled={!telegramConnected} onChange={(event) => setTelegramDiscoveryEnabled(event.target.checked)} />
              <span><strong>Telegram</strong><small>{telegramConnected ? "публичные каналы" : "сначала подключите аккаунт"}</small></span>
            </label>
          </div>
        </div>
        <div className="research-option-groups">
          <fieldset className="research-option-group">
            <legend><MapPin aria-hidden="true" />География поиска</legend>
            <div className="research-option-list research-country-list">
              {leadHunterCountries.map((country) => <label key={country.id} className="research-option">
                <input type="checkbox" checked={searchCountries.includes(country.id)} onChange={(event) => setSearchCountries((current) => event.target.checked ? [...current, country.id] : current.filter((value) => value !== country.id))} />
                <span>{country.label}</span>
              </label>)}
            </div>
          </fieldset>
          <fieldset className="research-option-group">
            <legend><Globe2 aria-hidden="true" />Категории рекламодателей</legend>
            <div className="research-option-list">
              {leadHunterCategories.map((category) => <label key={category.id} className="research-option">
                <input type="checkbox" checked={searchCategories.includes(category.id)} onChange={(event) => setSearchCategories((current) => event.target.checked ? [...current, category.id] : current.filter((value) => value !== category.id))} />
                <span>{category.label}</span>
              </label>)}
            </div>
          </fieldset>
        </div>
        <div className="research-config-actions">
          <label className="research-limit-select">Компаний за запуск
            <select value={searchLimit} onChange={(event) => setSearchLimit(event.target.value)}>
              {[20, 25, 30, 35, 40, 45, 50].filter((value) => value <= dailyTarget).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="research-config-buttons">
            <button type="submit" className="secondary-button" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить настройки"}</button>
            <button type="button" className="primary-button" disabled={searchPending || remaining === 0 || !searchCountries.length || !searchCategories.length} onClick={handleSearchNow}>
              {searchPending ? <LoaderCircle className="research-spinner" aria-hidden="true" /> : <Search aria-hidden="true" />}
              {searchPending ? "Ищем компании…" : "Начать поиск"}
            </button>
          </div>
        </div>
        <p className="research-footnote">Автопоиск выключен, пока вы явно его не включите. Источники Telegram добавляются в общий лимит только при отдельном включении и подключённом аккаунте; публикации не сохраняются целиком и не передаются AI.</p>
      </form>

      <details className="research-history">
        <summary><History aria-hidden="true" />История поиска <span>{research.searchRuns.length}</span></summary>
        {research.searchRuns.length ? <ul>{research.searchRuns.map((run) => <li key={run.id}>
          <div><strong>{leadHunterCategories.find((item) => item.id === run.searchCategory)?.label ?? run.searchCategory} · {leadHunterCountries.find((item) => item.id === run.searchCountry)?.label ?? run.searchCountry}</strong><span>{run.trigger === "scheduled" ? "Расписание" : "Вручную"} · {dateFormat.format(new Date(run.startedAt))}</span></div>
          <span className="research-history-count" data-status={run.status}>{run.status === "failed" ? "Ошибка" : run.status === "running" ? "Выполняется" : `Найдено ${run.discoveredCount}`}</span>
          {run.telegramLinkCount > 0 && <small>Ссылок Telegram: {run.telegramLinkCount}</small>}
          {run.errorMessage && <small className="research-error-text">{run.errorMessage}</small>}
        </li>)}</ul> : <p>Поиск ещё не запускался.</p>}
      </details>

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
  const [emailDraft, setEmailDraft] = useState(candidate.emailDraft ?? "")
  const [telegramDraft, setTelegramDraft] = useState(candidate.telegramDraft ?? "")
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
          <span className="research-source-type">{candidate.sourceProvider === "brave_search" ? `Brave Search · ${leadHunterCountries.find((item) => item.id === candidate.searchCountry)?.label ?? "региональный поиск"}` : sourceLabels[candidate.sourceType]}</span>
          <h4>{displayName}</h4>
          <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidate.websiteDomain}<ArrowUpRight aria-hidden="true" /></a>
        </div>
        <span className="research-status" data-status={candidate.status}>
          {candidate.status === "failed" && candidate.retryable ? "Временная ошибка" : statusLabels[candidate.status]}
        </span>
      </div>

      {candidate.searchQuery && <p className="research-discovery-note"><Search aria-hidden="true" />Запрос: {candidate.searchQuery}</p>}
      {candidate.searchResultDescription && <p className="research-result-description">{candidate.searchResultDescription}</p>}
      {(candidate.publicEmail || candidate.publicPhone || candidate.instagramUrl) && <div className="research-public-contacts">
        {candidate.publicEmail && <a href={`mailto:${candidate.publicEmail}`}>{candidate.publicEmail}</a>}
        {candidate.publicPhone && <a href={`tel:${candidate.publicPhone}`}>{candidate.publicPhone}</a>}
        {candidate.instagramUrl && <a href={candidate.instagramUrl} target="_blank" rel="noopener noreferrer">Instagram <ArrowUpRight aria-hidden="true" /></a>}
      </div>}
      {candidate.status === "pending" && <p className="research-state"><Clock3 aria-hidden="true" />Ожидает запуска. Анализ выполняется автоматически по расписанию; вручную можно запустить отдельно.</p>}
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
          <div className="research-analysis-copy"><span>{[candidate.industry, candidate.region, candidate.geographicCoverage].filter(Boolean).join(" · ") || "Отрасль или география не подтверждены источником"}</span><p>{candidate.summary}</p></div>
        </div>
        <div className="research-sponsor-metrics" aria-label="Эвристические оценки спонсорского потенциала">
          {[{ label: "Спонсорство", value: candidate.sponsorshipPotential }, { label: "Бартер", value: candidate.barterPotential }, { label: "Денежный формат", value: candidate.cashPotential }, { label: "Интерес к рекламе", value: candidate.advertisingFit }].map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value ?? "—"}<small>{metric.value == null ? "" : "/100"}</small></strong></div>)}
        </div>
        <p className="research-score-caveat">Оценки — ориентировочные сигналы на основе сайта компании, а не подтверждённые бюджет, намерение или вероятность сделки.</p>
        {candidate.fitRationale && <p className="research-rationale"><strong>Почему может подойти</strong>{candidate.fitRationale}</p>}
        {candidate.evidence.length > 0 && <details className="research-evidence">
          <summary>Проверяемые основания · {candidate.evidence.length}</summary>
          <ul>{candidate.evidence.map((item, index) => <li key={`${item.sourceUrl}-${item.field}-${index}`}><span className="research-evidence-field">{evidenceFieldLabels[item.field]}</span><strong>{item.claim}</strong><blockquote>{item.quote}</blockquote><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть источник <ArrowUpRight aria-hidden="true" /></a></li>)}</ul>
        </details>}
        {candidate.sourceRetrievedAt && <p className="research-retrieved">Источник проверен {dateFormat.format(new Date(candidate.sourceRetrievedAt))}</p>}
        <label className="research-proposal-label" htmlFor={`proposal-${candidate.id}`}>Черновик предложения · проверьте и отредактируйте
          <textarea id={`proposal-${candidate.id}`} value={proposal} onChange={(event) => setProposal(event.target.value)} maxLength={3000} rows={4} disabled={candidate.status === "saved"} />
        </label>
        <details className="research-outreach-drafts">
          <summary>Персональные сообщения · email и Telegram</summary>
          <label className="research-proposal-label" htmlFor={`email-draft-${candidate.id}`}>Черновик email · отправка только вручную после вашего подтверждения
            <textarea id={`email-draft-${candidate.id}`} value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} maxLength={3000} rows={4} disabled={candidate.status === "saved"} />
          </label>
          <label className="research-proposal-label" htmlFor={`telegram-draft-${candidate.id}`}>Черновик Telegram · отправка только вручную после вашего подтверждения
            <textarea id={`telegram-draft-${candidate.id}`} value={telegramDraft} onChange={(event) => setTelegramDraft(event.target.value)} maxLength={3000} rows={4} disabled={candidate.status === "saved"} />
          </label>
        </details>
      </>}

      {notice && <p className="research-card-notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <div className="research-card-actions">
        {(candidate.status === "pending" || candidate.status === "failed" && candidate.retryable) && <button type="button" className="primary-button" disabled={busy} onClick={() => runAction(() => analyzeLeadResearchCandidate(candidate.id), "AI-анализ завершён. Проверьте вывод и источники.")}>{busy ? <LoaderCircle className="research-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{candidate.status === "failed" ? "Повторить анализ" : "Анализировать сайт"}</button>}
        {candidate.status === "analyzed" && <>
          <button type="button" className="secondary-button" disabled={busy || !proposal.trim()} onClick={() => runAction(() => saveLeadResearchDraft(candidate.id, { proposalDraft: proposal, emailDraft, telegramDraft }), "Черновик предложения сохранён.")}>{busy ? "Сохраняем…" : "Сохранить черновик"}</button>
          <button type="button" className="primary-button" disabled={busy || !proposal.trim()} onClick={() => runAction(() => saveLeadResearchCandidate(candidate.id, { proposalDraft: proposal, emailDraft, telegramDraft }), "Лид добавлен в Lead Hunter; перед квалификацией проверьте сайт вручную.")}>{busy ? "Сохраняем…" : "Сохранить как лид"}</button>
        </>}
        {candidate.status === "saved" && <span className="research-saved"><BadgeCheck aria-hidden="true" />Лид ожидает ручной проверки в Lead Hunter</span>}
        {candidate.status === "rejected" && <span className="research-saved">Карточка закрыта</span>}
        {["pending", "failed", "analyzed"].includes(candidate.status) && <button type="button" className="research-reject" disabled={busy} onClick={() => runAction(() => rejectLeadResearchCandidate(candidate.id), "Карточка отклонена.")}>Отклонить</button>}
      </div>
    </article>
  )
}

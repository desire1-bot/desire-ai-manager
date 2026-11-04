"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  cancelTelegramDiscoveryLogin,
  completeTelegramDiscoveryLogin,
  disconnectTelegramDiscovery,
  searchTelegramPublicChannels,
  startTelegramDiscoveryLogin,
} from "@/app/actions/telegram-discovery"

type TelegramDiscoveryStatus = {
  connected: boolean
  loginPending: boolean
  accountUsername: string | null
  connectedAt: string | null
}

type Props = { status: TelegramDiscoveryStatus; dailyTarget: number }

export function TelegramDiscoveryPanel({ status, dailyTarget }: Props) {
  const router = useRouter()
  const [phoneNumber, setPhoneNumber] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [codeSent, setCodeSent] = useState(status.loginPending)
  const [requiresPassword, setRequiresPassword] = useState(false)
  const [consented, setConsented] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, startTransition] = useTransition()

  function handleStartLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    startTransition(async () => {
      const result = await startTelegramDiscoveryLogin({ phoneNumber, confirmed: consented })
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      setCodeSent(true)
      setNotice({ text: result.message })
    })
  }

  function handleFinishLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    startTransition(async () => {
      const result = await completeTelegramDiscoveryLogin({ code, password: password || undefined })
      if (!result.ok) {
        setNotice({ text: result.error, error: true })
        return
      }
      if (result.requiresPassword) {
        setRequiresPassword(true)
        setNotice({ text: result.message })
        return
      }
      setCode("")
      setPassword("")
      setRequiresPassword(false)
      setNotice({ text: result.message })
      router.refresh()
    })
  }

  function handleCancelLogin() {
    startTransition(async () => {
      const result = await cancelTelegramDiscoveryLogin()
      setCodeSent(false)
      setRequiresPassword(false)
      setCode("")
      setPassword("")
      setNotice({ text: result.message })
      router.refresh()
    })
  }

  function handleDisconnect() {
    if (!window.confirm("Отключить Telegram от Lead Hunter и отозвать эту сессию?")) return
    startTransition(async () => {
      const result = await disconnectTelegramDiscovery()
      setNotice({ text: result.message })
      router.refresh()
    })
  }

  function handleSearch() {
    setNotice(null)
    startTransition(async () => {
      const result = await searchTelegramPublicChannels()
      setNotice({ text: result.ok ? result.message : result.error ?? "Поиск не завершился.", error: !result.ok })
      if (result.ok && !result.skipped) router.refresh()
    })
  }

  return (
    <section className="telegram-discovery" aria-labelledby="telegram-discovery-title">
      <header className="telegram-discovery-header">
        <div>
          <span className="eyebrow">READ-ONLY · MTProto · ПУБЛИЧНЫЕ КАНАЛЫ</span>
          <h2 id="telegram-discovery-title">Поиск рекламных публикаций в Telegram</h2>
          <p>Авторизованный аккаунт используется только для глобального поиска по публичным каналам. Вступление в каналы, чтение личных диалогов и отправка сообщений не выполняются.</p>
        </div>
        <span className="telegram-discovery-status" data-connected={status.connected}>
          <span aria-hidden="true" />{status.connected ? "Аккаунт подключён" : "Аккаунт не подключён"}
        </span>
      </header>

      <div className="telegram-discovery-privacy" role="note">
        Тексты публикаций обрабатываются только временно для правил поиска и извлечения явно опубликованных рабочих контактов. Сохраняются ссылка на источник и числовые сигналы; текст публикаций не сохраняется и не передаётся AI. Оценка бюджета — только прокси по наблюдаемой частоте рекламы, не фактические расходы.
      </div>

      {status.connected ? (
        <div className="telegram-discovery-connected">
          <div>
            <strong>{status.accountUsername ? `@${status.accountUsername}` : "Telegram-аккаунт"}</strong>
            <span>Сессия зашифрована AES-256-GCM и хранится отдельно для вашей учётной записи.</span>
          </div>
          <div className="telegram-discovery-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={handleSearch}>
              {busy ? "Ищем…" : `Искать в публичных каналах · до ${dailyTarget}`}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={handleDisconnect}>Отключить</button>
          </div>
        </div>
      ) : codeSent ? (
        <form className="telegram-discovery-form" onSubmit={handleFinishLogin}>
          <div className="telegram-discovery-form-intro">
            <strong>Подтвердите вход</strong>
            <span>Введите код из Telegram. Если включена двухэтапная проверка, потребуется пароль аккаунта.</span>
          </div>
          <label htmlFor="telegram-discovery-code">Код Telegram
            <input id="telegram-discovery-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required pattern="[0-9]{4,8}" />
          </label>
          {requiresPassword && <label htmlFor="telegram-discovery-password">Пароль двухэтапной проверки
            <input id="telegram-discovery-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={256} required />
          </label>}
          <div className="telegram-discovery-actions">
            <button type="submit" className="primary-button" disabled={busy || code.trim().length < 4}>{busy ? "Проверяем…" : "Подтвердить"}</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={handleCancelLogin}>Отмена</button>
          </div>
        </form>
      ) : (
        <form className="telegram-discovery-form" onSubmit={handleStartLogin}>
          <label htmlFor="telegram-discovery-phone">Номер аккаунта в международном формате
            <input id="telegram-discovery-phone" type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} autoComplete="tel" placeholder="+79990000000" required pattern="\+[1-9][0-9]{7,14}" />
          </label>
          <label className="telegram-discovery-consent">
            <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} required />
            <span>Я контролирую этот аккаунт и разрешаю read-only поиск по публичным каналам. Сервис не будет вступать в каналы, читать личные диалоги или отправлять сообщения.</span>
          </label>
          <button type="submit" className="primary-button" disabled={busy || !consented || !phoneNumber.trim()}>{busy ? "Запрашиваем код…" : "Подключить Telegram"}</button>
        </form>
      )}

      {notice && <p className="telegram-discovery-notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </section>
  )
}

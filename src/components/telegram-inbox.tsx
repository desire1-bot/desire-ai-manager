"use client"

import { useState, useTransition, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bot, Check, Clock3, Inbox, LockKeyhole, MessageCircle, RefreshCw, Send, ShieldCheck, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle, AlertAction } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  approveAndSendTelegramDraft,
  claimTelegramIntegration,
  regenerateTelegramDraft,
  registerTelegramWebhook,
  rejectTelegramDraft,
  saveTelegramDraft,
} from "@/lib/telegram/actions"
import type { TelegramDraft, TelegramInboxData } from "@/lib/telegram/queries"

type TelegramInboxProps = {
  data: TelegramInboxData
  canConfigureWebhook: boolean
  webhookEnvironment: string
}

type Notice = { message: string; isError: boolean }

function displayName(firstName: string, lastName?: string | null) {
  return `${firstName} ${lastName ?? ""}`.trim() || "Контакт Telegram"
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function FeedbackNotice({ notice }: { notice: Notice }) {
  return (
    <Alert
      className="telegram-notice"
      data-tone={notice.isError ? "error" : "success"}
      role={notice.isError ? "alert" : "status"}
      variant={notice.isError ? "destructive" : "default"}
    >
      {notice.isError ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
      <AlertTitle>{notice.isError ? "Требуется внимание" : "Готово"}</AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  )
}

function EmptyPanel({ title, description }: { title: string; description: ReactNode }) {
  return (
    <Empty className="telegram-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MessageCircle aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function DraftCard({ draft, onNotice }: { draft: TelegramDraft; onNotice: (message: string, isError: boolean) => void }) {
  const [body, setBody] = useState(draft.body)
  const [busy, startTransition] = useTransition()
  const reviewed = draft.reviewedAt !== null

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await action()
      onNotice(result.ok ? result.message ?? "Готово." : result.error ?? "Не удалось выполнить действие.", !result.ok)
    })
  }

  return (
    <Card className="card telegram-draft-card">
      <CardHeader className="telegram-draft-header">
        <div>
          <h2>{displayName(draft.firstName, draft.lastName)}</h2>
          <CardDescription>{draft.username ? `@${draft.username}` : "Telegram-контакт"} · {formatDate(draft.createdAt)}</CardDescription>
        </div>
        <Badge
          className="telegram-draft-status"
          variant={draft.status === "pending" ? "secondary" : "destructive"}
        >
          <span className="telegram-status-dot" data-status={draft.status === "pending" ? "ready" : "waiting"} />
          {draft.status === "pending" ? "Ожидает проверки" : reviewed ? "Отправка не подтверждена" : "Нужен повтор"}
        </Badge>
      </CardHeader>
      <CardContent className="telegram-draft-content">
        <div className="telegram-draft-inbound"><strong>Входящее сообщение</strong><br />{draft.inboundText}</div>
        {reviewed ? (
          <div className="telegram-draft-warning">Telegram не подтвердил предыдущую отправку. Сначала проверьте переписку в Telegram; повторная отправка из этого черновика заблокирована.</div>
        ) : (
          <FieldGroup className="telegram-draft-form">
            <Field>
              <FieldLabel htmlFor={`telegram-draft-${draft.id}`}>Черновик ответа — отредактируйте перед отправкой</FieldLabel>
              <Textarea
                id={`telegram-draft-${draft.id}`}
                className="telegram-draft-textarea"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={4000}
                placeholder={draft.status === "failed" ? "Черновик не создан. Напишите ответ или повторите генерацию." : "Текст AI-черновика"}
                aria-label={`Черновик ответа для ${displayName(draft.firstName, draft.lastName)}`}
              />
              <FieldDescription>AI не подтверждает цены, скидки и коммерческие условия.</FieldDescription>
            </Field>
          </FieldGroup>
        )}
        {draft.status === "failed" && !reviewed && (
          <div className="telegram-draft-warning">Черновик не был отправлен. Можно написать ответ вручную или повторить генерацию.</div>
        )}
      </CardContent>
      {!reviewed && (
        <CardFooter className="telegram-draft-footer">
          <div className="telegram-draft-actions">
            <Button variant="secondary" type="button" disabled={busy || body.trim().length === 0} onClick={() => run(() => saveTelegramDraft({ draftId: draft.id, body }))}>
              <Check aria-hidden="true" data-icon="inline-start" />Сохранить
            </Button>
            {draft.status === "failed" ? (
              <Button variant="outline" type="button" disabled={busy} onClick={() => run(() => regenerateTelegramDraft(draft.id))}>
                <RefreshCw aria-hidden="true" data-icon="inline-start" />Повторить AI
              </Button>
            ) : (
              <Button variant="default" type="button" disabled={busy || body.trim().length === 0} onClick={() => {
                if (window.confirm("Одобрить и отправить этот отредактированный ответ в Telegram?")) {
                  run(() => approveAndSendTelegramDraft({ draftId: draft.id, body }))
                }
              }}>
                <Send aria-hidden="true" data-icon="inline-start" />Одобрить и отправить
              </Button>
            )}
            <Button variant="destructive" type="button" disabled={busy} onClick={() => {
              if (window.confirm("Отклонить черновик? Сообщение не будет отправлено.")) {
                run(() => rejectTelegramDraft(draft.id))
              }
            }}>
              <X aria-hidden="true" data-icon="inline-start" />Отклонить
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  )
}

export function TelegramInbox({ data, canConfigureWebhook, webhookEnvironment }: TelegramInboxProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [view, setView] = useState<"inbox" | "drafts">("inbox")
  const [busy, startTransition] = useTransition()
  const [notice, setNotice] = useState<Notice | null>(null)

  function showNotice(message: string, isError: boolean) {
    setNotice({ message, isError })
    router.refresh()
  }

  function selectConversation(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("conversation", id)
    router.push(`${pathname}?${params.toString()}`)
  }

  if (!data.isOwner) {
    return (
      <>
        {notice && <FeedbackNotice notice={notice} />}
        <Card className="card telegram-owner-lock">
          <CardHeader className="telegram-owner-lock-header">
            {data.canClaim ? <Bot aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            <div>
              <h2>{data.canClaim ? "Подключение для владельца CRM" : "Интеграция доступна владельцу CRM"}</h2>
              <CardDescription>{data.canClaim
                ? "Общий бот будет привязан только к учётной записи, созданной первой. Webhook и отправка сообщений не включаются автоматически."
                : "Для защиты общего Telegram-бота подключить его может только владелец исходного аккаунта CRM."}</CardDescription>
            </div>
          </CardHeader>
          {data.canClaim && (
            <CardFooter className="telegram-owner-lock-footer">
              <Button variant="default" type="button" disabled={busy} onClick={() => startTransition(async () => {
                const result = await claimTelegramIntegration()
                showNotice(result.ok ? result.message ?? "Бот привязан." : result.error ?? "Не удалось привязать бота.", !result.ok)
              })}>
                <Bot aria-hidden="true" data-icon="inline-start" />Привязать бота к CRM
              </Button>
            </CardFooter>
          )}
        </Card>
      </>
    )
  }

  const pendingCount = data.drafts.filter((draft) => draft.status === "pending").length

  return (
    <>
      <div className="telegram-summary" aria-label="Сводка Telegram">
        <Card className="telegram-summary-card"><CardContent className="telegram-summary-card-content"><span>Диалоги</span><strong>{data.conversations.length}</strong></CardContent></Card>
        <Card className="telegram-summary-card"><CardContent className="telegram-summary-card-content"><span>Ожидают проверки</span><strong>{pendingCount}</strong></CardContent></Card>
        <Card className="telegram-summary-card"><CardContent className="telegram-summary-card-content"><span>Автоотправка</span><strong>Выключена</strong></CardContent></Card>
      </div>

      <Alert className="telegram-setup" role="status">
        <ShieldCheck aria-hidden="true" />
        <div className="telegram-setup-copy">
          <AlertTitle><span className="telegram-status-dot" data-status={canConfigureWebhook ? "waiting" : "ready"} />Бот привязан к владельцу CRM · webhook не включён автоматически</AlertTitle>
          <AlertDescription>{canConfigureWebhook
            ? `Кнопка зарегистрирует endpoint только для этой среды (${webhookEnvironment}). Если у бота уже настроен другой URL, он не будет заменён.`
            : "Настройка доступна после развёртывания в Vercel Preview или Production. Новые входящие сообщения только сохраняются и создают черновики."}</AlertDescription>
        </div>
        {canConfigureWebhook && (
          <AlertAction className="telegram-setup-action">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => {
              if (window.confirm(`Зарегистрировать Telegram webhook для среды ${webhookEnvironment}? Это включит приём входящих сообщений, но не отправку ответов.`)) {
                startTransition(async () => {
                  const result = await registerTelegramWebhook()
                  showNotice(result.ok ? result.message ?? "Webhook настроен." : result.error ?? "Webhook не настроен.", !result.ok)
                })
              }
            }}>
              <Send aria-hidden="true" data-icon="inline-start" />Настроить webhook
            </Button>
          </AlertAction>
        )}
      </Alert>

      {notice && <FeedbackNotice notice={notice} />}

      <Tabs value={view} onValueChange={(value) => {
        if (value === "inbox" || value === "drafts") setView(value)
      }} className="telegram-view-tabs">
        <TabsList className="telegram-tabs" aria-label="Раздел Telegram">
          <TabsTrigger className="telegram-tab" value="inbox">
            <Inbox aria-hidden="true" data-icon="inline-start" />Диалоги
          </TabsTrigger>
          <TabsTrigger className="telegram-tab" value="drafts">
            <MessageCircle aria-hidden="true" data-icon="inline-start" />Черновики
            {pendingCount > 0 && <Badge variant="secondary" className="telegram-tab-count">{pendingCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="telegram-tab-content">
          <section className="telegram-workspace" aria-label="Telegram-диалоги">
            <aside className="telegram-conversation-panel">
              <div className="telegram-panel-heading"><strong>Все диалоги</strong><span>{data.conversations.length}</span></div>
              {data.conversations.length === 0 ? (
                <EmptyPanel title="Пока нет диалогов" description={<>После настройки webhook отправьте боту <span className="telegram-mono">/start</span>.</>} />
              ) : (
                <div className="telegram-conversation-list">
                  {data.conversations.map((conversation) => (
                    <Button
                      key={conversation.id}
                      variant="ghost"
                      size="lg"
                      type="button"
                      className="telegram-conversation"
                      aria-current={data.selectedConversation?.id === conversation.id ? "true" : undefined}
                      onClick={() => selectConversation(conversation.id)}
                    >
                      <span className="telegram-avatar" aria-hidden="true">{conversation.firstName.trim().slice(0, 1).toUpperCase() || "T"}</span>
                      <span className="telegram-conversation-copy">
                        <span className="telegram-conversation-top"><strong>{displayName(conversation.firstName, conversation.lastName)}</strong><time>{formatDate(conversation.lastMessageAt)}</time></span>
                        <span>{conversation.latestMessage || (conversation.username ? `@${conversation.username}` : "Новый диалог")}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </aside>

            <section className="telegram-thread-panel" aria-label="История переписки">
              {data.selectedConversation ? (
                <>
                  <header className="telegram-thread-heading">
                    <span className="telegram-avatar" aria-hidden="true">{data.selectedConversation.firstName.trim().slice(0, 1).toUpperCase() || "T"}</span>
                    <div><strong>{displayName(data.selectedConversation.firstName, data.selectedConversation.lastName)}</strong><span>{data.selectedConversation.username ? `@${data.selectedConversation.username}` : "Telegram"}</span></div>
                  </header>
                  <div className="telegram-transcript" role="log" aria-label="Сообщения диалога">
                    <MessageScrollerProvider>
                      <MessageScroller>
                        <MessageScrollerViewport className="telegram-transcript-viewport">
                          <MessageScrollerContent className="telegram-transcript-messages">
                            {data.messages.map((message, index) => {
                              const isOutbound = message.direction === "outbound"
                              const align = isOutbound ? "end" : "start"
                              return (
                                <MessageScrollerItem key={message.id} scrollAnchor={index === data.messages.length - 1}>
                                  <Message align={align} className="telegram-message-row">
                                    <MessageContent className="telegram-message-content">
                                      <Bubble variant={isOutbound ? "tinted" : "outline"} align={align} className="telegram-message-bubble">
                                        <BubbleContent className="telegram-message-text"><p>{message.text}</p></BubbleContent>
                                      </Bubble>
                                      <MessageFooter className="telegram-message-time"><time dateTime={message.sentAt}>{formatDate(message.sentAt)}</time></MessageFooter>
                                    </MessageContent>
                                  </Message>
                                </MessageScrollerItem>
                              )
                            })}
                          </MessageScrollerContent>
                        </MessageScrollerViewport>
                      </MessageScroller>
                    </MessageScrollerProvider>
                  </div>
                  <div className="telegram-thread-footnote"><Clock3 aria-hidden="true" />Ответы не отправляются автоматически. Проверьте черновик во вкладке «Черновики».</div>
                </>
              ) : (
                <EmptyPanel title="Выберите диалог" description="История сообщений появится здесь после входящего сообщения." />
              )}
            </section>
          </section>
        </TabsContent>

        <TabsContent value="drafts" className="telegram-tab-content">
          <section className="telegram-drafts" aria-label="Очередь черновиков">
            {data.drafts.length ? data.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} onNotice={showNotice} />) : (
              <Card className="card"><EmptyPanel title="Очередь пуста" description="Новые AI-черновики появятся после получения текстового сообщения." /></Card>
            )}
          </section>
        </TabsContent>
      </Tabs>
      <p className="telegram-thread-footnote"><ShieldCheck aria-hidden="true" />Каждый ответ требует ручного одобрения владельца. Цены, скидки и коммерческие условия не подтверждаются автоматически.</p>
    </>
  )
}

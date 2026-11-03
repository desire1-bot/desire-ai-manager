import { requireCurrentUser } from "@/lib/crm/queries"
import { getTelegramInboxData } from "@/lib/telegram/queries"
import { TelegramInbox } from "@/components/telegram-inbox"

type TelegramPageProps = {
  searchParams: Promise<{ conversation?: string }>
}

export default async function TelegramPage({ searchParams }: TelegramPageProps) {
  const [user, params] = await Promise.all([requireCurrentUser(), searchParams])
  const data = await getTelegramInboxData(user.id, params.conversation)
  const canConfigureWebhook = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production"
  const webhookEnvironment = process.env.VERCEL_ENV === "production" ? "Production" : "Preview"

  return (
    <div className="telegram-shell">
      <section className="page-heading telegram-heading">
        <div>
          <span className="eyebrow">КАНАЛ КОММУНИКАЦИЙ</span>
          <h1>Telegram</h1>
          <p>Входящие диалоги и черновики ответов, которые отправляются только после ручного одобрения.</p>
        </div>
      </section>
      <TelegramInbox
        data={data}
        canConfigureWebhook={canConfigureWebhook}
        webhookEnvironment={webhookEnvironment}
      />
    </div>
  )
}

import { timingSafeEqual } from "node:crypto"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { telegramSettings } from "@/lib/db/schema"
import { generateTelegramReplyDraft, saveIncomingTelegramMessage } from "@/lib/telegram/server"

export const runtime = "nodejs"
export const maxDuration = 30

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int().nonnegative().optional(),
    date: z.number().int().nonnegative().optional(),
    chat: z.object({ id: z.number().int(), type: z.string().optional() }).passthrough(),
    from: z.object({
      id: z.number().int().positive(),
      first_name: z.string().max(256),
      last_name: z.string().max(256).optional(),
      username: z.string().max(64).optional(),
    }).optional(),
    text: z.string().max(4096).optional(),
  }).passthrough().optional(),
}).passthrough()

function matchesSecret(received: string | null, expected: string) {
  if (!received || !/^[A-Za-z0-9_-]{1,256}$/.test(expected)) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedSecret) return Response.json({ ok: false }, { status: 503 })
  if (!matchesSecret(request.headers.get("x-telegram-bot-api-secret-token"), expectedSecret)) {
    return Response.json({ ok: false }, { status: 401 })
  }

  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
    return Response.json({ ok: false }, { status: 413 })
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, "utf8") > 65_536) {
    return Response.json({ ok: false }, { status: 413 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(payload)
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 })

  const message = parsed.data.message
  const text = message?.text?.trim()
  const isStartCommand = text ? /^\/start(?:@\w+)?(?:\s|$)/i.test(text) : false
  if (
    !message?.from
    || !message.text
    || message.message_id === undefined
    || message.date === undefined
    || message.chat.type !== "private"
    || message.chat.id !== message.from.id
    || (!isStartCommand && text?.startsWith("/"))
  ) {
    return Response.json({ ok: true })
  }

  const [settings] = await db.select({ userId: telegramSettings.userId })
    .from(telegramSettings)
    .where(eq(telegramSettings.id, "primary"))
    .limit(1)
  if (!settings) return Response.json({ ok: false }, { status: 503 })

  try {
    const saved = await saveIncomingTelegramMessage({
      ownerUserId: settings.userId,
      updateId: String(parsed.data.update_id),
      messageId: String(message.message_id),
      telegramUserId: String(message.from.id),
      username: message.from.username ?? null,
      firstName: message.from.first_name.trim() || "Telegram",
      lastName: message.from.last_name?.trim() || null,
      text: message.text,
      sentAt: new Date(message.date * 1000),
    })

    if (saved) {
      after(async () => {
        await generateTelegramReplyDraft(settings.userId, saved.conversationId, saved.messageId)
        revalidatePath("/telegram")
      })
    }

    return Response.json({ ok: true })
  } catch {
    console.error("[telegram] Webhook update could not be persisted")
    return Response.json({ ok: false }, { status: 500 })
  }
}

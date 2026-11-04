import "server-only"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { contacts, telegramConversations, telegramMessages, telegramReplyDrafts } from "@/lib/db/schema"

export type IncomingTelegramMessage = {
  ownerUserId: string
  updateId: string
  messageId: string
  telegramUserId: string
  username: string | null
  firstName: string
  lastName: string | null
  text: string
  sentAt: Date
}

export async function saveIncomingTelegramMessage(input: IncomingTelegramMessage) {
  return db.transaction(async (tx) => {
    const [duplicate] = await tx.select({ id: telegramMessages.id })
      .from(telegramMessages)
      .where(and(
        eq(telegramMessages.userId, input.ownerUserId),
        eq(telegramMessages.telegramUpdateId, input.updateId),
      ))
      .limit(1)

    if (duplicate) return null

    let [contact] = await tx.select({ id: contacts.id })
      .from(contacts)
      .where(and(
        eq(contacts.userId, input.ownerUserId),
        eq(contacts.telegramUserId, input.telegramUserId),
      ))
      .limit(1)

    if (!contact) {
      await tx.insert(contacts).values({
        id: randomUUID(),
        userId: input.ownerUserId,
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        telegramUserId: input.telegramUserId,
        telegramUsername: input.username,
        status: "lead",
      }).onConflictDoNothing()

      ;[contact] = await tx.select({ id: contacts.id })
        .from(contacts)
        .where(and(
          eq(contacts.userId, input.ownerUserId),
          eq(contacts.telegramUserId, input.telegramUserId),
        ))
        .limit(1)
    } else {
      await tx.update(contacts).set({
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        telegramUsername: input.username,
        updatedAt: new Date(),
      }).where(and(
        eq(contacts.id, contact.id),
        eq(contacts.userId, input.ownerUserId),
      ))
    }

    if (!contact) throw new Error("Could not link the Telegram contact")

    const [conversation] = await tx.insert(telegramConversations).values({
      id: randomUUID(),
      userId: input.ownerUserId,
      contactId: contact.id,
      telegramUserId: input.telegramUserId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      lastMessageAt: input.sentAt,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [telegramConversations.userId, telegramConversations.telegramUserId],
      set: {
        contactId: contact.id,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        lastMessageAt: input.sentAt,
        updatedAt: new Date(),
      },
    }).returning({ id: telegramConversations.id })

    const [savedMessage] = await tx.insert(telegramMessages).values({
      id: randomUUID(),
      userId: input.ownerUserId,
      conversationId: conversation.id,
      telegramMessageId: input.messageId,
      telegramUpdateId: input.updateId,
      direction: "inbound",
      text: input.text,
      sentAt: input.sentAt,
    }).onConflictDoNothing().returning({ id: telegramMessages.id })

    if (!savedMessage) return null

    await tx.insert(telegramReplyDrafts).values({
      id: randomUUID(),
      userId: input.ownerUserId,
      conversationId: conversation.id,
      inboundMessageId: savedMessage.id,
      body: "",
      status: "failed",
    }).onConflictDoNothing()

    return { conversationId: conversation.id, messageId: savedMessage.id }
  })
}

async function telegramApiRequest<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error("Telegram bot is not configured")

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !("result" in payload)) {
    throw new Error("Telegram API request failed")
  }
  return payload.result as T
}

export async function configureTelegramWebhook(targetUrl: string) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error("Telegram webhook secret is not configured correctly")
  }

  const current = await telegramApiRequest<{ url?: string }>("getWebhookInfo")
  if (current.url === targetUrl) return { alreadyConfigured: true }
  if (current.url) return { conflict: true }

  await telegramApiRequest<boolean>("setWebhook", {
    url: targetUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  })
  return { alreadyConfigured: false }
}

export async function sendTelegramMessage(chatId: string, text: string) {
  const result = await telegramApiRequest<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text,
  })

  if (!Number.isSafeInteger(result.message_id)) throw new Error("Telegram did not confirm the sent message")
  return { messageId: String(result.message_id) }
}

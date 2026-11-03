"use server"

import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  telegramConversations,
  telegramMessages,
  telegramReplyDrafts,
  telegramSettings,
  user as authUsers,
} from "@/lib/db/schema"
import { configureTelegramWebhook, generateTelegramReplyDraft, sendTelegramMessage } from "@/lib/telegram/server"

const idSchema = z.string().uuid()
const draftSchema = z.object({
  draftId: idSchema,
  body: z.string().trim().min(1).max(4000),
})

async function getAuthenticatedUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user.id ?? null
}

async function isTelegramOwner(userId: string) {
  const [settings] = await db.select({ userId: telegramSettings.userId })
    .from(telegramSettings)
    .where(eq(telegramSettings.id, "primary"))
    .limit(1)
  return settings?.userId === userId
}

function refreshTelegramPages() {
  revalidatePath("/telegram")
  revalidatePath("/contacts")
}

export async function claimTelegramIntegration() {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Войдите в CRM, чтобы подключить бота." }

  const [firstAccount] = await db.select({ id: authUsers.id })
    .from(authUsers)
    .orderBy(asc(authUsers.createdAt), asc(authUsers.id))
    .limit(1)
  if (firstAccount?.id !== userId) {
    return { ok: false as const, error: "Подключить общий Telegram-бот может только владелец аккаунта CRM." }
  }

  const [inserted] = await db.insert(telegramSettings).values({ id: "primary", userId })
    .onConflictDoNothing()
    .returning({ userId: telegramSettings.userId })
  if (inserted?.userId === userId) {
    refreshTelegramPages()
    return { ok: true as const, message: "Бот привязан к аккаунту владельца. Webhook ещё не включён." }
  }

  const alreadyOwner = await isTelegramOwner(userId)
  if (alreadyOwner) return { ok: true as const, message: "Бот уже привязан к вашему аккаунту." }
  return { ok: false as const, error: "Этот Telegram-бот уже привязан к другому аккаунту CRM." }
}

export async function registerTelegramWebhook() {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Войдите в CRM, чтобы настроить webhook." }
  if (!(await isTelegramOwner(userId))) {
    return { ok: false as const, error: "Настроить webhook может только владелец CRM." }
  }

  const environment = process.env.VERCEL_ENV
  if (environment !== "production" && environment !== "preview") {
    return { ok: false as const, error: "Webhook можно зарегистрировать только из развёрнутого Vercel Preview или Production." }
  }

  const host = environment === "production"
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
    : process.env.VERCEL_URL
  if (!host || !process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false as const, error: "В этой среде не настроен публичный домен или Telegram bot token." }
  }

  try {
    const result = await configureTelegramWebhook(`https://${host}/api/telegram/webhook`)
    if (result.conflict) {
      return { ok: false as const, error: "У бота уже настроен другой webhook. Он не был заменён; проверьте текущую настройку у Bot API перед переключением." }
    }
    refreshTelegramPages()
    return {
      ok: true as const,
      message: result.alreadyConfigured
        ? "Webhook уже указывает на эту среду. Новые сообщения только сохраняются и создают черновики."
        : "Webhook включён для этой среды. Автоматическая отправка ответов отключена.",
    }
  } catch (error) {
    const message = error instanceof Error && error.message === "Telegram webhook secret is not configured correctly"
      ? "Проверьте формат TELEGRAM_WEBHOOK_SECRET: Telegram принимает только латинские буквы, цифры, _ и - (до 256 символов)."
      : "Не удалось настроить webhook. Если у бота уже есть другой webhook, он не был заменён; сначала проверьте текущую настройку у Bot API."
    return { ok: false as const, error: message }
  }
}

export async function saveTelegramDraft(input: unknown) {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Черновик пуст или содержит слишком много текста." }
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Сессия завершилась. Войдите снова." }
  if (!(await isTelegramOwner(userId))) return { ok: false as const, error: "Нет доступа к этому черновику." }

  const [updated] = await db.update(telegramReplyDrafts).set({
    body: parsed.data.body,
    status: "pending",
    updatedAt: new Date(),
  }).where(and(
    eq(telegramReplyDrafts.id, parsed.data.draftId),
    eq(telegramReplyDrafts.userId, userId),
    inArray(telegramReplyDrafts.status, ["pending", "failed"]),
    isNull(telegramReplyDrafts.reviewedAt),
  )).returning({ id: telegramReplyDrafts.id })

  if (!updated) return { ok: false as const, error: "Черновик уже обработан или недоступен." }
  refreshTelegramPages()
  return { ok: true as const, message: "Черновик сохранён. Он не отправлен." }
}

export async function rejectTelegramDraft(draftId: string) {
  if (!idSchema.safeParse(draftId).success) return { ok: false as const, error: "Некорректный черновик." }
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Сессия завершилась. Войдите снова." }
  if (!(await isTelegramOwner(userId))) return { ok: false as const, error: "Нет доступа к этому черновику." }

  const [updated] = await db.update(telegramReplyDrafts).set({
    status: "rejected",
    reviewedBy: userId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(telegramReplyDrafts.id, draftId),
    eq(telegramReplyDrafts.userId, userId),
    inArray(telegramReplyDrafts.status, ["pending", "failed"]),
    isNull(telegramReplyDrafts.reviewedAt),
  )).returning({ id: telegramReplyDrafts.id })

  if (!updated) return { ok: false as const, error: "Черновик уже обработан или недоступен." }
  refreshTelegramPages()
  return { ok: true as const, message: "Черновик отклонён. Сообщение не отправлено." }
}

export async function regenerateTelegramDraft(draftId: string) {
  if (!idSchema.safeParse(draftId).success) return { ok: false as const, error: "Некорректный черновик." }
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Сессия завершилась. Войдите снова." }
  if (!(await isTelegramOwner(userId))) return { ok: false as const, error: "Нет доступа к этому черновику." }

  const [draft] = await db.select({
    id: telegramReplyDrafts.id,
    conversationId: telegramReplyDrafts.conversationId,
    inboundMessageId: telegramReplyDrafts.inboundMessageId,
    reviewedAt: telegramReplyDrafts.reviewedAt,
  }).from(telegramReplyDrafts).where(and(
    eq(telegramReplyDrafts.id, draftId),
    eq(telegramReplyDrafts.userId, userId),
    eq(telegramReplyDrafts.status, "failed"),
    isNull(telegramReplyDrafts.reviewedAt),
  )).limit(1)

  if (!draft) return { ok: false as const, error: "Черновик уже обработан или недоступен." }
  const result = await generateTelegramReplyDraft(userId, draft.conversationId, draft.inboundMessageId)
  refreshTelegramPages()
  return result.ok
    ? { ok: true as const, message: "Черновик готов к проверке. Он не отправлен." }
    : { ok: false as const, error: "Не удалось создать черновик. Проверьте настройки OpenAI и попробуйте снова." }
}

export async function approveAndSendTelegramDraft(input: unknown) {
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Проверьте текст ответа перед отправкой." }
  const userId = await getAuthenticatedUserId()
  if (!userId) return { ok: false as const, error: "Сессия завершилась. Войдите снова." }
  if (!(await isTelegramOwner(userId))) return { ok: false as const, error: "Только владелец CRM может одобрить и отправить ответ." }

  const [draft] = await db.select({
    id: telegramReplyDrafts.id,
    conversationId: telegramReplyDrafts.conversationId,
    telegramUserId: telegramConversations.telegramUserId,
  })
    .from(telegramReplyDrafts)
    .innerJoin(telegramConversations, and(
      eq(telegramConversations.id, telegramReplyDrafts.conversationId),
      eq(telegramConversations.userId, userId),
    ))
    .where(and(
      eq(telegramReplyDrafts.id, parsed.data.draftId),
      eq(telegramReplyDrafts.userId, userId),
      eq(telegramReplyDrafts.status, "pending"),
    ))
    .limit(1)

  if (!draft) return { ok: false as const, error: "Черновик уже обработан или недоступен." }

  const [claimed] = await db.update(telegramReplyDrafts).set({
    body: parsed.data.body,
    status: "sending",
    reviewedBy: userId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(telegramReplyDrafts.id, draft.id),
    eq(telegramReplyDrafts.userId, userId),
    eq(telegramReplyDrafts.status, "pending"),
  )).returning({ id: telegramReplyDrafts.id })

  if (!claimed) return { ok: false as const, error: "Черновик уже обработан. Обновите страницу." }

  try {
    const sent = await sendTelegramMessage(draft.telegramUserId, parsed.data.body)
    const sentAt = new Date()

    await db.transaction(async (tx) => {
      await tx.insert(telegramMessages).values({
        id: randomUUID(),
        userId,
        conversationId: draft.conversationId,
        telegramMessageId: sent.messageId,
        direction: "outbound",
        text: parsed.data.body,
        sentAt,
      })
      await tx.update(telegramReplyDrafts).set({ status: "sent", sentAt, updatedAt: sentAt })
        .where(and(eq(telegramReplyDrafts.id, draft.id), eq(telegramReplyDrafts.userId, userId)))
      await tx.update(telegramConversations).set({ lastMessageAt: sentAt, updatedAt: sentAt })
        .where(and(
          eq(telegramConversations.id, draft.conversationId),
          eq(telegramConversations.userId, userId),
        ))
    })

    refreshTelegramPages()
    return { ok: true as const, message: "Ответ отправлен после вашего подтверждения." }
  } catch {
    await db.update(telegramReplyDrafts).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(telegramReplyDrafts.id, draft.id), eq(telegramReplyDrafts.userId, userId)))
    refreshTelegramPages()
    return { ok: false as const, error: "Telegram не подтвердил отправку. Проверьте диалог в Telegram перед любым повтором." }
  }
}

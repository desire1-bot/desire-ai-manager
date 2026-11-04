"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCurrentUser } from "@/lib/crm/queries"
import {
  beginTelegramLogin,
  cancelTelegramLogin,
  disconnectTelegramAccount,
  finishTelegramLogin,
  telegramLoginErrorMessage,
} from "@/lib/telegram/discovery"
import { runTelegramPublicChannelSearch } from "@/lib/telegram/public-channel-search"

const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/)
const beginLoginSchema = z.object({ phoneNumber: phoneSchema, confirmed: z.literal(true) })
const finishLoginSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/),
  password: z.string().max(256).optional(),
})

export async function startTelegramDiscoveryLogin(input: unknown) {
  const parsed = beginLoginSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Введите номер в международном формате и подтвердите разрешение на read-only поиск." }

  const user = await requireCurrentUser()
  try {
    const result = await beginTelegramLogin(user.id, parsed.data.phoneNumber)
    revalidatePath("/leads")
    return {
      ok: true as const,
      codeViaApp: result.codeViaApp,
      message: result.codeViaApp
        ? "Код отправлен в приложение Telegram. Введите его ниже."
        : "Код отправлен способом, выбранным Telegram. Введите его ниже.",
    }
  } catch (error) {
    const message = error instanceof Error && error.message === "INVALID_PHONE"
      ? "Введите номер в международном формате, например +79990000000."
      : telegramLoginErrorMessage(error)
    return { ok: false as const, error: message }
  }
}

export async function completeTelegramDiscoveryLogin(input: unknown) {
  const parsed = finishLoginSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Введите код Telegram и пароль двухэтапной проверки, если он включён." }

  const user = await requireCurrentUser()
  try {
    const result = await finishTelegramLogin(user.id, parsed.data.code, parsed.data.password)
    if (result.requiresPassword) {
      return { ok: true as const, requiresPassword: true as const, message: "Введите пароль двухэтапной проверки Telegram." }
    }
    revalidatePath("/leads")
    return {
      ok: true as const,
      requiresPassword: false as const,
      message: result.accountUsername
        ? `Telegram подключён как @${result.accountUsername}. Используется только для публичного поиска.`
        : "Telegram подключён. Используется только для публичного поиска.",
    }
  } catch (error) {
    return { ok: false as const, error: telegramLoginErrorMessage(error) }
  }
}

export async function cancelTelegramDiscoveryLogin() {
  const user = await requireCurrentUser()
  await cancelTelegramLogin(user.id)
  revalidatePath("/leads")
  return { ok: true as const, message: "Подключение Telegram отменено." }
}

export async function disconnectTelegramDiscovery() {
  const user = await requireCurrentUser()
  await disconnectTelegramAccount(user.id)
  revalidatePath("/leads")
  return { ok: true as const, message: "Telegram отключён от Lead Hunter. Новые поиски не запускаются." }
}

export async function searchTelegramPublicChannels() {
  const user = await requireCurrentUser()
  const result = await runTelegramPublicChannelSearch(user.id, "manual")
  revalidatePath("/leads")
  return result
}

import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { Api, TelegramClient } from "teleproto"
import { StringSession } from "teleproto/sessions"
import { db } from "@/lib/db"
import { leadHunterSettings, telegramDiscoverySessions } from "@/lib/db/schema"

type TelegramCredentials = { apiId: number; apiHash: string }
type PendingTelegramAuth = {
  phoneNumber: string
  phoneCodeHash: string
  sessionString: string
  expiresAt: number
}
const pendingAuthLifetimeMs = 10 * 60 * 1000
const codeRequestCooldownMs = 60 * 1000
const authFailureWindowMs = 15 * 60 * 1000
const maxAuthFailures = 5

function getCredentials(): TelegramCredentials {
  const apiId = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Telegram MTProto credentials are not configured.")
  }
  return { apiId, apiHash }
}

function getEncryptionKey() {
  const encoded = process.env.TELEGRAM_SESSION_ENCRYPTION_KEY
  if (!encoded) throw new Error("Telegram session encryption is not configured.")
  const key = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  if (key.length !== 32) throw new Error("Telegram session encryption key must decode to 32 bytes.")
  return key
}

function sessionAad(userId: string) {
  return Buffer.from(`desire-ai-manager:telegram-session:v1:${userId}`)
}

function encryptForUser(userId: string, plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv)
  cipher.setAAD(sessionAad(userId))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`
}

function decryptForUser(userId: string, encoded: string) {
  const [version, ivPart, tagPart, ciphertextPart] = encoded.split(".")
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Stored Telegram session is invalid.")
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivPart, "base64url"))
  decipher.setAAD(sessionAad(userId))
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

function createClient(sessionString = "") {
  const credentials = getCredentials()
  return new TelegramClient(new StringSession(sessionString), credentials.apiId, credentials.apiHash, {
    connectionRetries: 1,
  })
}

function getRpcCode(error: unknown) {
  if (error && typeof error === "object" && "errorMessage" in error && typeof error.errorMessage === "string") {
    return error.errorMessage
  }
  return error instanceof Error ? error.message : ""
}

export function telegramLoginErrorMessage(error: unknown) {
  const code = getRpcCode(error)
  if (code === "LOGIN_RATE_LIMITED") return "Повторный запрос кода доступен через минуту."
  if (code === "LOGIN_EXPIRED") return "Срок действия кода истёк. Запросите новый код."
  if (code === "LOGIN_ATTEMPTS_EXCEEDED") return "Слишком много неверных попыток. Запросите новый код позже."
  if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EMPTY") return "Код Telegram неверен. Проверьте его и попробуйте ещё раз."
  if (code === "PHONE_CODE_EXPIRED") return "Код Telegram истёк. Запросите новый код."
  if (code === "PASSWORD_HASH_INVALID") return "Пароль двухэтапной проверки неверен."
  if (code.startsWith("FLOOD_WAIT")) return "Telegram временно ограничил вход. Подождите и повторите попытку позже."
  if (code === "EMAIL_VERIFICATION_REQUIRED" || code === "EMAIL_SETUP_REQUIRED") return "Telegram запросил дополнительную проверку по email. Этот способ входа пока её не поддерживает."
  return "Не удалось подключить Telegram. Проверьте номер, код и настройки API, затем попробуйте снова."
}

async function reserveCodeRequest(userId: string) {
  const requestedAt = new Date()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-login:${userId}`}, 0))`)
    const [existing] = await tx.select({ lastCodeRequestedAt: telegramDiscoverySessions.lastCodeRequestedAt })
      .from(telegramDiscoverySessions)
      .where(eq(telegramDiscoverySessions.userId, userId))
      .limit(1)
    if (existing?.lastCodeRequestedAt && requestedAt.getTime() - existing.lastCodeRequestedAt.getTime() < codeRequestCooldownMs) {
      throw new Error("LOGIN_RATE_LIMITED")
    }
    await tx.insert(telegramDiscoverySessions).values({ userId, lastCodeRequestedAt: requestedAt })
      .onConflictDoUpdate({
        target: telegramDiscoverySessions.userId,
        set: { lastCodeRequestedAt: requestedAt, updatedAt: requestedAt },
      })
  })
}

export async function beginTelegramLogin(userId: string, phoneNumber: string) {
  const credentials = getCredentials()
  getEncryptionKey()
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error("INVALID_PHONE")
  await reserveCodeRequest(userId)

  const client = new TelegramClient(new StringSession(""), credentials.apiId, credentials.apiHash, {
    connectionRetries: 1,
  })
  try {
    await client.connect()
    const sent = await client.sendCode(credentials, phoneNumber)
    if (sent.emailRequired || sent.emailCodeSent) throw new Error("EMAIL_VERIFICATION_REQUIRED")
    const pending: PendingTelegramAuth = {
      phoneNumber,
      phoneCodeHash: sent.phoneCodeHash,
      sessionString: client.session.save(),
      expiresAt: Date.now() + pendingAuthLifetimeMs,
    }
    const now = new Date()
    await db.insert(telegramDiscoverySessions).values({
      userId,
      pendingAuthCiphertext: encryptForUser(userId, JSON.stringify(pending)),
      failedAttempts: 0,
      failureWindowStartedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: telegramDiscoverySessions.userId,
      set: {
        pendingAuthCiphertext: encryptForUser(userId, JSON.stringify(pending)),
        failedAttempts: 0,
        failureWindowStartedAt: null,
        updatedAt: now,
      },
    })
    return { codeViaApp: sent.isCodeViaApp }
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

async function recordAuthFailure(userId: string) {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`telegram-login:${userId}`}, 0))`)
    const [row] = await tx.select({
      failedAttempts: telegramDiscoverySessions.failedAttempts,
      failureWindowStartedAt: telegramDiscoverySessions.failureWindowStartedAt,
    }).from(telegramDiscoverySessions)
      .where(eq(telegramDiscoverySessions.userId, userId))
      .limit(1)
    if (!row) return
    const expiredWindow = !row.failureWindowStartedAt || now.getTime() - row.failureWindowStartedAt.getTime() > authFailureWindowMs
    const failedAttempts = (expiredWindow ? 0 : row.failedAttempts) + 1
    await tx.update(telegramDiscoverySessions).set({
      failedAttempts,
      failureWindowStartedAt: expiredWindow ? now : row.failureWindowStartedAt,
      pendingAuthCiphertext: failedAttempts >= maxAuthFailures ? null : undefined,
      updatedAt: now,
    }).where(eq(telegramDiscoverySessions.userId, userId))
  })
}

export async function finishTelegramLogin(userId: string, phoneCode: string, password?: string) {
  const credentials = getCredentials()
  getEncryptionKey()
  const [row] = await db.select({
    pendingAuthCiphertext: telegramDiscoverySessions.pendingAuthCiphertext,
    failedAttempts: telegramDiscoverySessions.failedAttempts,
    failureWindowStartedAt: telegramDiscoverySessions.failureWindowStartedAt,
  }).from(telegramDiscoverySessions)
    .where(eq(telegramDiscoverySessions.userId, userId))
    .limit(1)

  if (!row?.pendingAuthCiphertext) throw new Error("LOGIN_EXPIRED")
  if (row.failureWindowStartedAt && Date.now() - row.failureWindowStartedAt.getTime() < authFailureWindowMs && row.failedAttempts >= maxAuthFailures) {
    throw new Error("LOGIN_ATTEMPTS_EXCEEDED")
  }

  const pending = JSON.parse(decryptForUser(userId, row.pendingAuthCiphertext)) as PendingTelegramAuth
  if (pending.expiresAt < Date.now()) {
    await db.update(telegramDiscoverySessions).set({ pendingAuthCiphertext: null, updatedAt: new Date() })
      .where(eq(telegramDiscoverySessions.userId, userId))
    throw new Error("LOGIN_EXPIRED")
  }

  const client = createClient(pending.sessionString)
  try {
    await client.connect()
    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode,
      }))
    } catch (error) {
      const code = getRpcCode(error)
      if (code !== "SESSION_PASSWORD_NEEDED") throw error
      if (!password) return { requiresPassword: true as const }
      await client.signInWithPassword(credentials, {
        password: async () => password,
        onError: () => {},
      })
    }

    const account = await client.getMe()
    if (!account || !("id" in account)) throw new Error("ACCOUNT_NOT_AUTHORIZED")
    const now = new Date()
    await db.update(telegramDiscoverySessions).set({
      sessionCiphertext: encryptForUser(userId, client.session.save()),
      pendingAuthCiphertext: null,
      accountId: String(account.id),
      accountUsername: "username" in account && typeof account.username === "string" ? account.username : null,
      connectedAt: now,
      failedAttempts: 0,
      failureWindowStartedAt: null,
      updatedAt: now,
    }).where(eq(telegramDiscoverySessions.userId, userId))
    return {
      requiresPassword: false as const,
      accountUsername: "username" in account && typeof account.username === "string" ? account.username : null,
    }
  } catch (error) {
    if (getRpcCode(error) !== "SESSION_PASSWORD_NEEDED") await recordAuthFailure(userId)
    throw error
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

export async function cancelTelegramLogin(userId: string) {
  await db.update(telegramDiscoverySessions).set({
    pendingAuthCiphertext: null,
    failedAttempts: 0,
    failureWindowStartedAt: null,
    updatedAt: new Date(),
  }).where(eq(telegramDiscoverySessions.userId, userId))
}

export async function getTelegramDiscoveryStatus(userId: string) {
  const [row] = await db.select({
    sessionCiphertext: telegramDiscoverySessions.sessionCiphertext,
    pendingAuthCiphertext: telegramDiscoverySessions.pendingAuthCiphertext,
    accountUsername: telegramDiscoverySessions.accountUsername,
    connectedAt: telegramDiscoverySessions.connectedAt,
  }).from(telegramDiscoverySessions)
    .where(eq(telegramDiscoverySessions.userId, userId))
    .limit(1)

  return {
    connected: Boolean(row?.sessionCiphertext),
    loginPending: Boolean(row?.pendingAuthCiphertext),
    accountUsername: row?.accountUsername ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
  }
}

export async function disconnectTelegramAccount(userId: string) {
  const [row] = await db.select({ sessionCiphertext: telegramDiscoverySessions.sessionCiphertext })
    .from(telegramDiscoverySessions)
    .where(eq(telegramDiscoverySessions.userId, userId))
    .limit(1)

  if (row?.sessionCiphertext) {
    const client = createClient(decryptForUser(userId, row.sessionCiphertext))
    try {
      await client.connect()
      await client.logOut()
    } catch {
      // Local credentials are still cleared below if Telegram is temporarily unavailable.
    } finally {
      await client.disconnect().catch(() => undefined)
    }
  }

  await db.update(telegramDiscoverySessions).set({
    sessionCiphertext: null,
    pendingAuthCiphertext: null,
    accountId: null,
    accountUsername: null,
    connectedAt: null,
    failedAttempts: 0,
    failureWindowStartedAt: null,
    updatedAt: new Date(),
  }).where(eq(telegramDiscoverySessions.userId, userId))
  await db.update(leadHunterSettings).set({ telegramDiscoveryEnabled: false, updatedAt: new Date() })
    .where(eq(leadHunterSettings.userId, userId))
}

export async function createAuthorizedTelegramClient(userId: string) {
  const [row] = await db.select({ sessionCiphertext: telegramDiscoverySessions.sessionCiphertext })
    .from(telegramDiscoverySessions)
    .where(eq(telegramDiscoverySessions.userId, userId))
    .limit(1)
  if (!row?.sessionCiphertext) throw new Error("TELEGRAM_NOT_CONNECTED")

  const client = createClient(decryptForUser(userId, row.sessionCiphertext))
  try {
    await client.connect()
    if (!await client.checkAuthorization()) throw new Error("TELEGRAM_SESSION_EXPIRED")
    return client
  } catch (error) {
    await client.disconnect().catch(() => undefined)
    throw error
  }
}

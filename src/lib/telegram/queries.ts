import "server-only"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  contacts,
  telegramConversations,
  telegramMessages,
  telegramReplyDrafts,
  telegramSettings,
  user as authUsers,
} from "@/lib/db/schema"

export type TelegramConversationSummary = {
  id: string
  contactId: string
  firstName: string
  lastName: string | null
  username: string | null
  lastMessageAt: string
  latestMessage: string | null
}

export type TelegramThreadMessage = {
  id: string
  text: string
  direction: string
  sentAt: string
}

export type TelegramDraft = {
  id: string
  conversationId: string
  body: string
  status: string
  reviewedAt: string | null
  inboundText: string
  firstName: string
  lastName: string | null
  username: string | null
  createdAt: string
}

export type TelegramInboxData = {
  isOwner: boolean
  canClaim: boolean
  conversations: TelegramConversationSummary[]
  selectedConversation: TelegramConversationSummary | null
  messages: TelegramThreadMessage[]
  drafts: TelegramDraft[]
}

export async function getTelegramInboxData(userId: string, requestedConversationId?: string): Promise<TelegramInboxData> {
  const [settings] = await db.select({ userId: telegramSettings.userId })
    .from(telegramSettings)
    .where(eq(telegramSettings.id, "primary"))
    .limit(1)

  const isOwner = settings?.userId === userId
  if (!isOwner) {
    const [firstAccount] = settings
      ? []
      : await db.select({ id: authUsers.id })
        .from(authUsers)
        .orderBy(asc(authUsers.createdAt), asc(authUsers.id))
        .limit(1)

    return {
      isOwner: false,
      canClaim: !settings && firstAccount?.id === userId,
      conversations: [],
      selectedConversation: null,
      messages: [],
      drafts: [],
    }
  }

  const conversationRows = await db.select({
    id: telegramConversations.id,
    contactId: telegramConversations.contactId,
    firstName: telegramConversations.firstName,
    lastName: telegramConversations.lastName,
    username: telegramConversations.username,
    lastMessageAt: telegramConversations.lastMessageAt,
    latestMessage: sql<string | null>`(
      SELECT ${telegramMessages.text}
      FROM ${telegramMessages}
      WHERE ${telegramMessages.userId} = ${userId}
        AND ${telegramMessages.conversationId} = ${telegramConversations.id}
      ORDER BY ${telegramMessages.sentAt} DESC
      LIMIT 1
    )`,
  })
    .from(telegramConversations)
    .innerJoin(contacts, and(
      eq(contacts.id, telegramConversations.contactId),
      eq(contacts.userId, userId),
    ))
    .where(eq(telegramConversations.userId, userId))
    .orderBy(desc(telegramConversations.lastMessageAt))
    .limit(100)

  const conversations: TelegramConversationSummary[] = conversationRows.map((row) => ({
    ...row,
    lastMessageAt: row.lastMessageAt.toISOString(),
  }))
  const selectedConversation = conversations.find((conversation) => conversation.id === requestedConversationId)
    ?? conversations[0]
    ?? null

  const messageRows = selectedConversation
    ? await db.select({
        id: telegramMessages.id,
        text: telegramMessages.text,
        direction: telegramMessages.direction,
        sentAt: telegramMessages.sentAt,
      })
        .from(telegramMessages)
        .where(and(
          eq(telegramMessages.userId, userId),
          eq(telegramMessages.conversationId, selectedConversation.id),
        ))
        .orderBy(desc(telegramMessages.sentAt))
        .limit(100)
    : []

  const draftRows = await db.select({
    id: telegramReplyDrafts.id,
    conversationId: telegramReplyDrafts.conversationId,
    body: telegramReplyDrafts.body,
    status: telegramReplyDrafts.status,
    reviewedAt: telegramReplyDrafts.reviewedAt,
    inboundText: telegramMessages.text,
    firstName: telegramConversations.firstName,
    lastName: telegramConversations.lastName,
    username: telegramConversations.username,
    createdAt: telegramReplyDrafts.createdAt,
  })
    .from(telegramReplyDrafts)
    .innerJoin(telegramMessages, and(
      eq(telegramMessages.id, telegramReplyDrafts.inboundMessageId),
      eq(telegramMessages.userId, userId),
    ))
    .innerJoin(telegramConversations, and(
      eq(telegramConversations.id, telegramReplyDrafts.conversationId),
      eq(telegramConversations.userId, userId),
    ))
    .where(and(
      eq(telegramReplyDrafts.userId, userId),
      inArray(telegramReplyDrafts.status, ["pending", "failed"]),
    ))
    .orderBy(asc(telegramReplyDrafts.createdAt))
    .limit(100)

  return {
    isOwner: true,
    canClaim: false,
    conversations,
    selectedConversation,
    messages: messageRows.reverse().map((message) => ({ ...message, sentAt: message.sentAt.toISOString() })),
    drafts: draftRows.map((draft) => ({
      ...draft,
      reviewedAt: draft.reviewedAt?.toISOString() ?? null,
      createdAt: draft.createdAt.toISOString(),
    })),
  }
}

import { z } from "zod";
import { PageId, Page } from "./schema";
export const MessageSubmission = z
  .object({
    id: z.uuid(),
    pageId: PageId,
    pageUpdatedAt: z.iso.datetime(),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();
export const AgentReceipt = z.object({ messageId: z.uuid() }).strict();
export const AgentReply = z
  .object({
    id: z.uuid(),
    messageId: z.uuid(),
    text: z.string().trim().min(1).max(12000),
  })
  .strict();
export const ConversationMessage = z.object({
  id: z.uuid(),
  role: z.enum(["user", "agent"]),
  text: z.string(),
  createdAt: z.iso.datetime(),
  receivedAt: z.iso.datetime().nullable(),
  replyTo: z.uuid().nullable(),
});
export const Conversation = z.object({
  id: z.string(),
  page: Page,
  agentId: PageId.optional(),
  messages: z.array(ConversationMessage),
});
export type ReportConversation = z.infer<typeof Conversation>;

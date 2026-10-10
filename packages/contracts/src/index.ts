import { z } from "zod";

export const roles = ["requester", "agent", "admin"] as const;
export const statuses = ["open", "in_progress", "waiting", "closed"] as const;
export const priorities = ["low", "normal", "high", "urgent"] as const;
export const descriptionFormats = ["text", "markdown"] as const;
export const announcementKinds = ["news", "maintenance", "incident"] as const;
export const noticeKinds = ["released", "maintenance", "incident"] as const;

export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(200) });
export const createTicketSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(20_000),
  priority: z.enum(priorities).default("normal"),
  descriptionFormat: z.enum(descriptionFormats).default("text")
});
export const updateTicketSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
  assigneeId: z.uuid().nullable().optional()
}).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one field must change");
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  visibility: z.enum(["public", "internal"]).default("public"),
  bodyFormat: z.enum(descriptionFormats).default("text")
});
export const attachmentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  commentId: z.uuid().optional()
});
export const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const createArticleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().max(100_000)
});
export const updateArticleSchema = createArticleSchema.extend({ version: z.number().int().positive() });
export const createAnnouncementSchema = z.object({
  kind: z.enum(announcementKinds),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(5_000),
  endsAt: z.iso.datetime({ offset: true }).nullable().default(null)
});
export const updateAnnouncementSchema = createAnnouncementSchema.extend({ version: z.number().int().positive() });
// Without a version the notice must not exist yet; with one it must still be at that version.
export const setNoticeSchema = z.object({
  kind: z.enum(noticeKinds),
  message: z.string().trim().min(1).max(500),
  version: z.number().int().positive().optional()
});
export const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(imageTypes),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024)
});
export type Role =(typeof roles)[number];
export type TicketStatus = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type AnnouncementKind = (typeof announcementKinds)[number];
export type NoticeKind = (typeof noticeKinds)[number];

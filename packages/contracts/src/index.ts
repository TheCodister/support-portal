import { z } from "zod";

export const roles = ["requester", "agent", "admin"] as const;
export const statuses = ["open", "in_progress", "waiting", "closed"] as const;
export const priorities = ["low", "normal", "high", "urgent"] as const;

export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(200) });
export const createTicketSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(20_000),
  priority: z.enum(priorities).default("normal")
});
export const updateTicketSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
  assigneeId: z.uuid().nullable().optional()
}).refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one field must change");
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  visibility: z.enum(["public", "internal"]).default("public")
});
export const attachmentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  commentId: z.uuid().optional()
});
export const knowledgeImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const createArticleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().max(100_000)
});
export const updateArticleSchema = createArticleSchema.extend({ version: z.number().int().positive() });
export const knowledgeImageRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(knowledgeImageTypes),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024)
});
export type Role =(typeof roles)[number];
export type TicketStatus = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];

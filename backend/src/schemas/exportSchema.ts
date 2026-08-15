import { z } from 'zod';

/**
 * Export Markdown Query Parameters Schema
 * Validates the query parameters for the export API
 */
export const ExportMarkdownQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * Export Markdown Response Schema
 * Validates the API response structure
 */
export const ExportMarkdownResponseSchema = z.object({
  markdown: z.string(),
  metadata: z.object({
    userId: z.string(),
    exportTime: z.string().datetime(),
    sessionCount: z.number(),
    timeRange: z.object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
    }),
    protocol_version: z.string().default('2.0.0'),
  }),
});

/**
 * Export Options Schema
 * Internal schema for export service options
 */
export const ExportOptionsSchema = z.object({
  userId: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type ExportMarkdownQuery = z.infer<typeof ExportMarkdownQuerySchema>;
export type ExportMarkdownResponse = z.infer<typeof ExportMarkdownResponseSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

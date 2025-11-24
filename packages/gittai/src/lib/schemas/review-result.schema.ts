import { z } from 'zod';

// Severity levels for review comments
export const SeveritySchema = z.enum(['error', 'warning', 'info', 'suggestion']);
export type Severity = z.infer<typeof SeveritySchema>;

// Position information for a comment
export const CommentPositionSchema = z.object({
  filePath: z.string().describe('File path relative to repository root'),
  startLine: z.number().int().positive().describe('Starting line number (1-indexed)'),
  endLine: z.number().int().positive().optional().describe('Ending line number for multi-line comments'),
}).refine(
  (data) => !data.endLine || data.endLine >= data.startLine,
  { message: 'endLine must be greater than or equal to startLine' }
);
export type CommentPosition = z.infer<typeof CommentPositionSchema>;

// Code suggestion with optional diff
export const CodeSuggestionSchema = z.object({
  code: z.string().describe('Suggested code to replace the commented lines'),
  description: z.string().optional().describe('Optional explanation for the suggestion'),
});
export type CodeSuggestion = z.infer<typeof CodeSuggestionSchema>;

// Individual review comment
export const ReviewCommentSchema = z.object({
  position: CommentPositionSchema,
  message: z.string().min(1).describe('The review comment message'),
  severity: SeveritySchema.default('info'),
  suggestion: CodeSuggestionSchema.optional().describe('Optional code suggestion'),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

// Complete review result
export const ReviewResultSchema = z.object({
  comments: z.array(ReviewCommentSchema).describe('Array of review comments'),
  metadata: z.object({
    baseSha: z.string().optional().describe('Base commit SHA (will be fetched from MR if not provided)'),
    headSha: z.string().optional().describe('Head commit SHA (will be fetched from MR if not provided)'),
    reviewedAt: z.string().datetime().optional().describe('ISO timestamp of when review was performed'),
    reviewer: z.string().optional().describe('Name or identifier of the AI reviewer'),
  }).optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// Validation function
export function validateReviewResult(data: unknown): ReviewResult {
  return ReviewResultSchema.parse(data);
}

// Safe validation with error details
export function safeValidateReviewResult(data: unknown): 
  { success: true; data: ReviewResult } | { success: false; error: z.ZodError } {
  const result = ReviewResultSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

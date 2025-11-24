"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewResultSchema = exports.ReviewCommentSchema = exports.CodeSuggestionSchema = exports.CommentPositionSchema = exports.SeveritySchema = void 0;
exports.validateReviewResult = validateReviewResult;
exports.safeValidateReviewResult = safeValidateReviewResult;
var zod_1 = require("zod");
// Severity levels for review comments
exports.SeveritySchema = zod_1.z.enum(['error', 'warning', 'info', 'suggestion']);
// Position information for a comment
exports.CommentPositionSchema = zod_1.z.object({
    filePath: zod_1.z.string().describe('File path relative to repository root'),
    startLine: zod_1.z.number().int().positive().describe('Starting line number (1-indexed)'),
    endLine: zod_1.z.number().int().positive().optional().describe('Ending line number for multi-line comments'),
}).refine(function (data) { return !data.endLine || data.endLine >= data.startLine; }, { message: 'endLine must be greater than or equal to startLine' });
// Code suggestion with optional diff
exports.CodeSuggestionSchema = zod_1.z.object({
    code: zod_1.z.string().describe('Suggested code to replace the commented lines'),
    description: zod_1.z.string().optional().describe('Optional explanation for the suggestion'),
});
// Individual review comment
exports.ReviewCommentSchema = zod_1.z.object({
    position: exports.CommentPositionSchema,
    message: zod_1.z.string().min(1).describe('The review comment message'),
    severity: exports.SeveritySchema.default('info'),
    suggestion: exports.CodeSuggestionSchema.optional().describe('Optional code suggestion'),
});
// Complete review result
exports.ReviewResultSchema = zod_1.z.object({
    comments: zod_1.z.array(exports.ReviewCommentSchema).describe('Array of review comments'),
    metadata: zod_1.z.object({
        baseSha: zod_1.z.string().optional().describe('Base commit SHA (will be fetched from MR if not provided)'),
        headSha: zod_1.z.string().optional().describe('Head commit SHA (will be fetched from MR if not provided)'),
        reviewedAt: zod_1.z.string().datetime().optional().describe('ISO timestamp of when review was performed'),
        reviewer: zod_1.z.string().optional().describe('Name or identifier of the AI reviewer'),
    }).optional(),
});
// Validation function
function validateReviewResult(data) {
    return exports.ReviewResultSchema.parse(data);
}
// Safe validation with error details
function safeValidateReviewResult(data) {
    var result = exports.ReviewResultSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}

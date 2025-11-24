import { describe, it, expect } from '@jest/globals';
import {
  ReviewResultSchema,
  ReviewCommentSchema,
  CommentPositionSchema,
  SeveritySchema,
  validateReviewResult,
  safeValidateReviewResult,
} from './review-result.schema.js';

describe('ReviewResultSchema', () => {
  describe('SeveritySchema', () => {
    it('should accept valid severity values', () => {
      expect(SeveritySchema.parse('error')).toBe('error');
      expect(SeveritySchema.parse('warning')).toBe('warning');
      expect(SeveritySchema.parse('info')).toBe('info');
      expect(SeveritySchema.parse('suggestion')).toBe('suggestion');
    });

    it('should reject invalid severity values', () => {
      expect(() => SeveritySchema.parse('critical')).toThrow();
    });
  });

  describe('CommentPositionSchema', () => {
    it('should accept valid single-line position', () => {
      const position = {
        filePath: 'src/index.ts',
        startLine: 42,
      };
      expect(CommentPositionSchema.parse(position)).toEqual(position);
    });

    it('should accept valid multi-line position', () => {
      const position = {
        filePath: 'src/index.ts',
        startLine: 10,
        endLine: 20,
      };
      expect(CommentPositionSchema.parse(position)).toEqual(position);
    });

    it('should reject when endLine < startLine', () => {
      const position = {
        filePath: 'src/index.ts',
        startLine: 20,
        endLine: 10,
      };
      expect(() => CommentPositionSchema.parse(position)).toThrow();
    });

    it('should reject negative line numbers', () => {
      expect(() =>
        CommentPositionSchema.parse({ filePath: 'src/index.ts', startLine: -1 })
      ).toThrow();
    });
  });

  describe('ReviewCommentSchema', () => {
    it('should accept comment without suggestion', () => {
      const comment = {
        position: { filePath: 'src/index.ts', startLine: 42 },
        message: 'This needs improvement',
        severity: 'warning' as const,
      };
      expect(ReviewCommentSchema.parse(comment)).toEqual(comment);
    });

    it('should accept comment with suggestion', () => {
      const comment = {
        position: { filePath: 'src/index.ts', startLine: 42 },
        message: 'Use const instead of let',
        severity: 'suggestion' as const,
        suggestion: {
          code: 'const value = 42;',
          description: 'Constants are preferred',
        },
      };
      expect(ReviewCommentSchema.parse(comment)).toEqual(comment);
    });

    it('should default severity to info', () => {
      const comment = {
        position: { filePath: 'src/index.ts', startLine: 42 },
        message: 'Consider refactoring',
      };
      const parsed = ReviewCommentSchema.parse(comment);
      expect(parsed.severity).toBe('info');
    });

    it('should reject empty message', () => {
      const comment = {
        position: { filePath: 'src/index.ts', startLine: 42 },
        message: '',
      };
      expect(() => ReviewCommentSchema.parse(comment)).toThrow();
    });
  });

  describe('ReviewResultSchema', () => {
    it('should accept valid review result', () => {
      const result = {
        comments: [
          {
            position: { filePath: 'src/index.ts', startLine: 42 },
            message: 'Test comment',
            severity: 'info' as const,
          },
        ],
        metadata: {
          baseSha: 'abc123',
          headSha: 'def456',
          reviewedAt: '2024-01-01T00:00:00Z',
          reviewer: 'AI Reviewer',
        },
      };
      expect(ReviewResultSchema.parse(result)).toEqual(result);
    });

    it('should accept result without metadata', () => {
      const result = {
        comments: [
          {
            position: { filePath: 'src/index.ts', startLine: 42 },
            message: 'Test comment',
          },
        ],
      };
      expect(() => ReviewResultSchema.parse(result)).not.toThrow();
    });

    it('should accept empty comments array', () => {
      const result = { comments: [] };
      expect(ReviewResultSchema.parse(result)).toEqual(result);
    });
  });

  describe('validateReviewResult', () => {
    it('should validate and return parsed data', () => {
      const data = {
        comments: [
          {
            position: { filePath: 'src/index.ts', startLine: 42 },
            message: 'Test',
          },
        ],
      };
      expect(validateReviewResult(data)).toEqual(
        expect.objectContaining({ comments: expect.any(Array) })
      );
    });

    it('should throw on invalid data', () => {
      expect(() => validateReviewResult({ invalid: 'data' })).toThrow();
    });
  });

  describe('safeValidateReviewResult', () => {
    it('should return success for valid data', () => {
      const data = {
        comments: [
          {
            position: { filePath: 'src/index.ts', startLine: 42 },
            message: 'Test',
          },
        ],
      };
      const result = safeValidateReviewResult(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.comments).toHaveLength(1);
      }
    });

    it('should return error for invalid data', () => {
      const result = safeValidateReviewResult({ invalid: 'data' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});

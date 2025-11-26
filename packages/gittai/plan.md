# GitLab Code Review Comment Script - Implementation Plan

## Overview
Add a Node.js script to the `gittai` library that reads AI-generated code review results and posts them as inline discussions to GitLab merge requests using `@gitbeaker/rest`. The script will support both Personal Access Tokens and CI Job Tokens, include Zod schemas for type-safe validation, and handle multi-line suggestions with GitLab's suggestion syntax.

## Architecture

### Core Components

1. **Review Result Schema** (`src/lib/schemas/review-result.schema.ts`)
   - Zod schemas for type-safe validation
   - Support for single-line and multi-line comments
   - Severity levels (error, warning, info, suggestion)
   - Optional code suggestions with GitLab markdown support

2. **GitLab Client Wrapper** (`src/lib/gitlab-client.ts`)
   - Factory function for `@gitbeaker/rest` Gitlab client
   - Support for PAT and CI Job Token authentication
   - Environment variable configuration

3. **Review Comment Poster** (`src/lib/gitlab-reviewer.ts`)
   - Read and validate review results JSON
   - Transform to GitLab discussion format
   - Handle position mapping (line numbers, file paths, commit SHAs)
   - Format suggestions using GitLab's triple-backtick syntax

4. **CLI Script** (`src/scripts/post-review-comments.ts`)
   - Command-line interface
   - Environment variable support for CI/CD
   - Fetch MR details for commit SHAs
   - Orchestrate the review posting process

## Implementation Steps

### Step 1: Add Dependencies
**File**: `packages/gittai/package.json`

Add `zod` to dependencies:
```json
{
  "dependencies": {
    "tslib": "^2.8.1",
    "zod": "^3.23.8"
  }
}
```

Note: `@gitbeaker/rest@^43.8.0` is already available at workspace root level.

### Step 2: Create Review Result Schema
**File**: `src/lib/schemas/review-result.schema.ts`

```typescript
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
```

### Step 3: Implement GitLab Client Wrapper
**File**: `src/lib/gitlab-client.ts`

```typescript
import { Gitlab } from '@gitbeaker/rest';

export interface GitlabClientConfig {
  /** GitLab host URL (defaults to process.env.CI_SERVER_URL or 'https://gitlab.com') */
  host?: string;
  /** Personal Access Token */
  token?: string;
  /** CI Job Token (for CI/CD contexts) */
  jobToken?: string;
  /** OAuth token */
  oauthToken?: string;
}

export function createGitlabClient(config: GitlabClientConfig): Gitlab {
  const { host, token, jobToken, oauthToken } = config;
  
  // Determine host
  const gitlabHost = host || process.env.CI_SERVER_URL || 'https://gitlab.com';
  
  // Determine authentication method
  if (jobToken) {
    return new Gitlab({
      host: gitlabHost,
      jobToken,
    });
  }
  
  if (oauthToken) {
    return new Gitlab({
      host: gitlabHost,
      oauthToken,
    });
  }
  
  if (token) {
    return new Gitlab({
      host: gitlabHost,
      token,
    });
  }
  
  throw new Error(
    'No authentication method provided. Please provide one of: token, jobToken, or oauthToken'
  );
}

export function createGitlabClientFromEnv(): Gitlab {
  // Try CI Job Token first (most common in CI/CD)
  if (process.env.CI_JOB_TOKEN) {
    return createGitlabClient({
      jobToken: process.env.CI_JOB_TOKEN,
    });
  }
  
  // Fallback to PAT
  if (process.env.GITLAB_TOKEN) {
    return createGitlabClient({
      token: process.env.GITLAB_TOKEN,
    });
  }
  
  throw new Error(
    'No GitLab authentication found in environment. Set CI_JOB_TOKEN or GITLAB_TOKEN'
  );
}
```

### Step 4: Build Comment Poster Logic
**File**: `src/lib/gitlab-reviewer.ts`

```typescript
import type { Gitlab } from '@gitbeaker/rest';
import type { DiscussionNotePositionOptions } from '@gitbeaker/rest';
import type { ReviewResult, ReviewComment, Severity } from './schemas/review-result.schema.js';
import { readFile } from 'fs/promises';
import { validateReviewResult } from './schemas/review-result.schema.js';

export interface MergeRequestInfo {
  projectId: string | number;
  mergeRequestIid: number;
  baseSha: string;
  startSha: string;
  headSha: string;
}

export interface PostReviewOptions {
  /** Whether to include severity prefix in comments (default: true) */
  includeSeverityPrefix?: boolean;
  /** Custom severity emoji mapping */
  severityEmoji?: Record<Severity, string>;
}

const DEFAULT_SEVERITY_EMOJI: Record<Severity, string> = {
  error: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
  suggestion: '💡',
};

/**
 * Read and parse a review results JSON file
 */
export async function readReviewResults(filePath: string): Promise<ReviewResult> {
  const fileContent = await readFile(filePath, 'utf-8');
  const data = JSON.parse(fileContent);
  return validateReviewResult(data);
}

/**
 * Format a review comment message with severity prefix and optional suggestion
 */
function formatCommentMessage(
  comment: ReviewComment,
  options: PostReviewOptions = {}
): string {
  const { includeSeverityPrefix = true, severityEmoji = DEFAULT_SEVERITY_EMOJI } = options;
  
  let message = '';
  
  // Add severity prefix
  if (includeSeverityPrefix) {
    const emoji = severityEmoji[comment.severity];
    const severityText = comment.severity.toUpperCase();
    message += `**${emoji} ${severityText}**\n\n`;
  }
  
  // Add main message
  message += comment.message;
  
  // Add suggestion if present
  if (comment.suggestion) {
    message += '\n\n';
    if (comment.suggestion.description) {
      message += `${comment.suggestion.description}\n\n`;
    }
    
    // Format as GitLab suggestion
    const lines = comment.suggestion.code.split('\n');
    const lineCount = lines.length;
    const commentLines = comment.position.endLine 
      ? comment.position.endLine - comment.position.startLine + 1 
      : 1;
    
    // Calculate suggestion offset (lines to remove vs lines to add)
    const offset = lineCount !== commentLines ? `:-${commentLines}+${lineCount}` : '';
    
    message += `\`\`\`suggestion${offset}\n${comment.suggestion.code}\n\`\`\``;
  }
  
  return message;
}

/**
 * Create a position object for GitLab discussion
 */
function createPosition(
  comment: ReviewComment,
  mrInfo: MergeRequestInfo
): DiscussionNotePositionOptions {
  const position: DiscussionNotePositionOptions = {
    baseSha: mrInfo.baseSha,
    startSha: mrInfo.startSha,
    headSha: mrInfo.headSha,
    positionType: 'text',
    newPath: comment.position.filePath,
    newLine: comment.position.startLine,
  };
  
  // Add line range for multi-line comments
  if (comment.position.endLine && comment.position.endLine > comment.position.startLine) {
    position.lineRange = {
      start: {
        lineCode: `${mrInfo.headSha}_${comment.position.startLine}_${comment.position.startLine}`,
        type: 'new',
      },
      end: {
        lineCode: `${mrInfo.headSha}_${comment.position.endLine}_${comment.position.endLine}`,
        type: 'new',
      },
    };
  }
  
  return position;
}

/**
 * Post review comments to a GitLab merge request
 */
export async function postReviewComments(
  client: Gitlab,
  mrInfo: MergeRequestInfo,
  reviewResult: ReviewResult,
  options: PostReviewOptions = {}
): Promise<void> {
  const { comments } = reviewResult;
  
  console.log(`Posting ${comments.length} review comments to MR !${mrInfo.mergeRequestIid}...`);
  
  const results = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ comment: ReviewComment; error: string }>,
  };
  
  for (const comment of comments) {
    try {
      const message = formatCommentMessage(comment, options);
      const position = createPosition(comment, mrInfo);
      
      await client.MergeRequestDiscussions.create(
        mrInfo.projectId,
        mrInfo.mergeRequestIid,
        message,
        { position }
      );
      
      results.success++;
      console.log(
        `✓ Posted comment on ${comment.position.filePath}:${comment.position.startLine}`
      );
    } catch (error) {
      results.failed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.errors.push({ comment, error: errorMessage });
      console.error(
        `✗ Failed to post comment on ${comment.position.filePath}:${comment.position.startLine}: ${errorMessage}`
      );
    }
  }
  
  console.log(`\nResults: ${results.success} succeeded, ${results.failed} failed`);
  
  if (results.errors.length > 0) {
    console.error('\nFailed comments:');
    results.errors.forEach(({ comment, error }) => {
      console.error(`  - ${comment.position.filePath}:${comment.position.startLine} - ${error}`);
    });
  }
}

/**
 * Fetch merge request details to get commit SHAs
 */
export async function fetchMergeRequestInfo(
  client: Gitlab,
  projectId: string | number,
  mergeRequestIid: number
): Promise<MergeRequestInfo> {
  const mr = await client.MergeRequests.show(projectId, mergeRequestIid);
  
  if (!mr.diff_refs) {
    throw new Error(`Merge request !${mergeRequestIid} has no diff_refs. Is it a valid MR?`);
  }
  
  return {
    projectId,
    mergeRequestIid,
    baseSha: mr.diff_refs.base_sha,
    startSha: mr.diff_refs.start_sha,
    headSha: mr.diff_refs.head_sha,
  };
}
```

### Step 5: Create CLI Script
**File**: `src/scripts/post-review-comments.ts`

```typescript
#!/usr/bin/env node

import { createGitlabClient, createGitlabClientFromEnv } from '../lib/gitlab-client.js';
import { readReviewResults, postReviewComments, fetchMergeRequestInfo } from '../lib/gitlab-reviewer.js';
import { exit } from 'process';

interface CLIArgs {
  reviewResultsFile: string;
  projectId?: string;
  mergeRequestIid?: number;
  token?: string;
  jobToken?: string;
  host?: string;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  
  const parsed: CLIArgs = {
    reviewResultsFile: '',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--file':
      case '-f':
        parsed.reviewResultsFile = nextArg;
        i++;
        break;
      case '--project-id':
      case '-p':
        parsed.projectId = nextArg;
        i++;
        break;
      case '--mr-iid':
      case '-m':
        parsed.mergeRequestIid = parseInt(nextArg, 10);
        i++;
        break;
      case '--token':
      case '-t':
        parsed.token = nextArg;
        i++;
        break;
      case '--job-token':
        parsed.jobToken = nextArg;
        i++;
        break;
      case '--host':
        parsed.host = nextArg;
        i++;
        break;
      case '--help':
      case '-h':
        printUsage();
        exit(0);
        break;
      default:
        // Treat as file path if no file specified yet
        if (!parsed.reviewResultsFile) {
          parsed.reviewResultsFile = arg;
        }
    }
  }
  
  return parsed;
}

function printUsage(): void {
  console.log(`
Usage: gittai [options] <review-results-file>

Post AI-generated code review comments to a GitLab merge request.

Options:
  -f, --file <path>           Path to review results JSON file
  -p, --project-id <id>       GitLab project ID (default: CI_PROJECT_ID env)
  -m, --mr-iid <number>       Merge request IID (default: CI_MERGE_REQUEST_IID env)
  -t, --token <token>         GitLab personal access token (default: GITLAB_TOKEN env)
  --job-token <token>         GitLab CI job token (default: CI_JOB_TOKEN env)
  --host <url>                GitLab host URL (default: CI_SERVER_URL or https://gitlab.com)
  -h, --help                  Show this help message

Environment Variables:
  CI_PROJECT_ID               GitLab project ID (auto-set in CI)
  CI_MERGE_REQUEST_IID        Merge request IID (auto-set in CI)
  CI_JOB_TOKEN               CI job token (auto-set in CI, preferred)
  GITLAB_TOKEN               Personal access token (fallback)
  CI_SERVER_URL              GitLab server URL (auto-set in CI)

Examples:
  # In GitLab CI (uses CI environment variables)
  gittai review-results.json

  # With explicit arguments
  gittai --file review-results.json --project-id 123 --mr-iid 456 --token glpat-xxx

  # Using job token
  gittai review-results.json --job-token $CI_JOB_TOKEN
`);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();
    
    // Validate required arguments
    if (!args.reviewResultsFile) {
      console.error('Error: Review results file is required\n');
      printUsage();
      exit(1);
    }
    
    const projectId = args.projectId || process.env.CI_PROJECT_ID;
    const mergeRequestIid = args.mergeRequestIid || 
      (process.env.CI_MERGE_REQUEST_IID ? parseInt(process.env.CI_MERGE_REQUEST_IID, 10) : undefined);
    
    if (!projectId || !mergeRequestIid) {
      console.error('Error: Project ID and MR IID are required (via args or CI environment)\n');
      printUsage();
      exit(1);
    }
    
    // Create GitLab client
    const client = args.token || args.jobToken
      ? createGitlabClient({
          token: args.token,
          jobToken: args.jobToken,
          host: args.host,
        })
      : createGitlabClientFromEnv();
    
    // Read review results
    console.log(`Reading review results from ${args.reviewResultsFile}...`);
    const reviewResult = await readReviewResults(args.reviewResultsFile);
    console.log(`Found ${reviewResult.comments.length} comments to post`);
    
    // Fetch MR info
    console.log(`Fetching merge request !${mergeRequestIid} details...`);
    const mrInfo = await fetchMergeRequestInfo(client, projectId, mergeRequestIid);
    console.log(`MR base: ${mrInfo.baseSha.substring(0, 8)}, head: ${mrInfo.headSha.substring(0, 8)}`);
    
    // Post comments
    await postReviewComments(client, mrInfo, reviewResult);
    
    console.log('\n✓ Review comments posted successfully');
    exit(0);
  } catch (error) {
    console.error('\n✗ Error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    exit(1);
  }
}

main();
```

### Step 6: Export Public API and Configure CLI
**File**: `src/index.ts`

```typescript
// Export schemas
export * from './lib/schemas/review-result.schema.js';

// Export client creation
export { createGitlabClient, createGitlabClientFromEnv } from './lib/gitlab-client.js';
export type { GitlabClientConfig } from './lib/gitlab-client.js';

// Export reviewer functions
export {
  readReviewResults,
  postReviewComments,
  fetchMergeRequestInfo,
} from './lib/gitlab-reviewer.js';
export type { MergeRequestInfo, PostReviewOptions } from './lib/gitlab-reviewer.js';
```

**File**: `package.json` (add bin section)

```json
{
  "name": "@thdk/gittai",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "gittai": "./dist/scripts/post-review-comments.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

### Step 7: Add Comprehensive Tests

**File**: `src/lib/schemas/review-result.schema.spec.ts`

```typescript
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
```

**File**: `src/lib/gitlab-reviewer.spec.ts`

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Gitlab } from '@gitbeaker/rest';
import {
  postReviewComments,
  fetchMergeRequestInfo,
  readReviewResults,
} from './gitlab-reviewer.js';
import type { ReviewResult } from './schemas/review-result.schema.js';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('gitlab-reviewer', () => {
  describe('readReviewResults', () => {
    it('should read and validate review results file', async () => {
      const tempFile = join(tmpdir(), `test-review-${Date.now()}.json`);
      const data: ReviewResult = {
        comments: [
          {
            position: { filePath: 'src/test.ts', startLine: 1 },
            message: 'Test comment',
            severity: 'info',
          },
        ],
      };

      await writeFile(tempFile, JSON.stringify(data));

      try {
        const result = await readReviewResults(tempFile);
        expect(result.comments).toHaveLength(1);
        expect(result.comments[0].message).toBe('Test comment');
      } finally {
        await unlink(tempFile);
      }
    });

    it('should throw on invalid JSON', async () => {
      const tempFile = join(tmpdir(), `test-invalid-${Date.now()}.json`);
      await writeFile(tempFile, 'invalid json');

      try {
        await expect(readReviewResults(tempFile)).rejects.toThrow();
      } finally {
        await unlink(tempFile);
      }
    });
  });

  describe('fetchMergeRequestInfo', () => {
    it('should fetch MR details and extract SHAs', async () => {
      const mockClient = {
        MergeRequests: {
          show: jest.fn().mockResolvedValue({
            diff_refs: {
              base_sha: 'base123',
              start_sha: 'start123',
              head_sha: 'head123',
            },
          }),
        },
      } as unknown as Gitlab;

      const info = await fetchMergeRequestInfo(mockClient, 'project-1', 42);

      expect(info).toEqual({
        projectId: 'project-1',
        mergeRequestIid: 42,
        baseSha: 'base123',
        startSha: 'start123',
        headSha: 'head123',
      });
      expect(mockClient.MergeRequests.show).toHaveBeenCalledWith('project-1', 42);
    });

    it('should throw if MR has no diff_refs', async () => {
      const mockClient = {
        MergeRequests: {
          show: jest.fn().mockResolvedValue({}),
        },
      } as unknown as Gitlab;

      await expect(
        fetchMergeRequestInfo(mockClient, 'project-1', 42)
      ).rejects.toThrow('has no diff_refs');
    });
  });

  describe('postReviewComments', () => {
    let mockClient: Gitlab;

    beforeEach(() => {
      mockClient = {
        MergeRequestDiscussions: {
          create: jest.fn().mockResolvedValue({ id: 'discussion-1' }),
        },
      } as unknown as Gitlab;
    });

    it('should post single-line comments', async () => {
      const reviewResult: ReviewResult = {
        comments: [
          {
            position: { filePath: 'src/test.ts', startLine: 10 },
            message: 'Fix this',
            severity: 'error',
          },
        ],
      };

      const mrInfo = {
        projectId: 'project-1',
        mergeRequestIid: 42,
        baseSha: 'base123',
        startSha: 'start123',
        headSha: 'head123',
      };

      await postReviewComments(mockClient, mrInfo, reviewResult);

      expect(mockClient.MergeRequestDiscussions.create).toHaveBeenCalledWith(
        'project-1',
        42,
        expect.stringContaining('ERROR'),
        expect.objectContaining({
          position: expect.objectContaining({
            baseSha: 'base123',
            newLine: 10,
            newPath: 'src/test.ts',
          }),
        })
      );
    });

    it('should post multi-line comments with lineRange', async () => {
      const reviewResult: ReviewResult = {
        comments: [
          {
            position: { filePath: 'src/test.ts', startLine: 10, endLine: 15 },
            message: 'Refactor this block',
            severity: 'warning',
          },
        ],
      };

      const mrInfo = {
        projectId: 'project-1',
        mergeRequestIid: 42,
        baseSha: 'base123',
        startSha: 'start123',
        headSha: 'head123',
      };

      await postReviewComments(mockClient, mrInfo, reviewResult);

      expect(mockClient.MergeRequestDiscussions.create).toHaveBeenCalledWith(
        'project-1',
        42,
        expect.stringContaining('WARNING'),
        expect.objectContaining({
          position: expect.objectContaining({
            lineRange: expect.objectContaining({
              start: expect.objectContaining({ type: 'new' }),
              end: expect.objectContaining({ type: 'new' }),
            }),
          }),
        })
      );
    });

    it('should format suggestions correctly', async () => {
      const reviewResult: ReviewResult = {
        comments: [
          {
            position: { filePath: 'src/test.ts', startLine: 10 },
            message: 'Use const',
            severity: 'suggestion',
            suggestion: {
              code: 'const value = 42;',
              description: 'Constants are better',
            },
          },
        ],
      };

      const mrInfo = {
        projectId: 'project-1',
        mergeRequestIid: 42,
        baseSha: 'base123',
        startSha: 'start123',
        headSha: 'head123',
      };

      await postReviewComments(mockClient, mrInfo, reviewResult);

      const call = (mockClient.MergeRequestDiscussions.create as jest.Mock).mock.calls[0];
      expect(call[2]).toContain('```suggestion');
      expect(call[2]).toContain('const value = 42;');
      expect(call[2]).toContain('Constants are better');
    });

    it('should continue on error and report failures', async () => {
      const mockCreate = jest
        .fn()
        .mockResolvedValueOnce({ id: 'discussion-1' })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ id: 'discussion-3' });

      mockClient = {
        MergeRequestDiscussions: {
          create: mockCreate,
        },
      } as unknown as Gitlab;

      const reviewResult: ReviewResult = {
        comments: [
          {
            position: { filePath: 'src/test1.ts', startLine: 10 },
            message: 'Comment 1',
          },
          {
            position: { filePath: 'src/test2.ts', startLine: 20 },
            message: 'Comment 2',
          },
          {
            position: { filePath: 'src/test3.ts', startLine: 30 },
            message: 'Comment 3',
          },
        ],
      };

      const mrInfo = {
        projectId: 'project-1',
        mergeRequestIid: 42,
        baseSha: 'base123',
        startSha: 'start123',
        headSha: 'head123',
      };

      await postReviewComments(mockClient, mrInfo, reviewResult);

      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
```

**File**: `src/lib/gitlab-client.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createGitlabClient, createGitlabClientFromEnv } from './gitlab-client.js';

describe('gitlab-client', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createGitlabClient', () => {
    it('should create client with PAT', () => {
      const client = createGitlabClient({ token: 'test-token' });
      expect(client).toBeDefined();
    });

    it('should create client with job token', () => {
      const client = createGitlabClient({ jobToken: 'job-token' });
      expect(client).toBeDefined();
    });

    it('should create client with custom host', () => {
      const client = createGitlabClient({
        token: 'test-token',
        host: 'https://gitlab.example.com',
      });
      expect(client).toBeDefined();
    });

    it('should throw if no authentication provided', () => {
      expect(() => createGitlabClient({})).toThrow('No authentication method provided');
    });

    it('should prefer jobToken over token', () => {
      const client = createGitlabClient({
        token: 'test-token',
        jobToken: 'job-token',
      });
      expect(client).toBeDefined();
    });
  });

  describe('createGitlabClientFromEnv', () => {
    it('should create client from CI_JOB_TOKEN', () => {
      process.env.CI_JOB_TOKEN = 'job-token';
      process.env.CI_SERVER_URL = 'https://gitlab.example.com';

      const client = createGitlabClientFromEnv();
      expect(client).toBeDefined();
    });

    it('should create client from GITLAB_TOKEN', () => {
      delete process.env.CI_JOB_TOKEN;
      process.env.GITLAB_TOKEN = 'test-token';

      const client = createGitlabClientFromEnv();
      expect(client).toBeDefined();
    });

    it('should prefer CI_JOB_TOKEN over GITLAB_TOKEN', () => {
      process.env.CI_JOB_TOKEN = 'job-token';
      process.env.GITLAB_TOKEN = 'test-token';

      const client = createGitlabClientFromEnv();
      expect(client).toBeDefined();
    });

    it('should throw if no env tokens available', () => {
      delete process.env.CI_JOB_TOKEN;
      delete process.env.GITLAB_TOKEN;

      expect(() => createGitlabClientFromEnv()).toThrow(
        'No GitLab authentication found in environment'
      );
    });
  });
});
```

## Review Results JSON Schema Example

Here's an example of the expected review results file format:

```json
{
  "comments": [
    {
      "position": {
        "filePath": "src/utils/auth.ts",
        "startLine": 42
      },
      "message": "This function lacks input validation. Consider adding checks for null/undefined values.",
      "severity": "warning"
    },
    {
      "position": {
        "filePath": "src/models/user.ts",
        "startLine": 15,
        "endLine": 25
      },
      "message": "This class could be simplified by using a TypeScript interface instead.",
      "severity": "suggestion",
      "suggestion": {
        "code": "interface User {\n  id: string;\n  name: string;\n  email: string;\n}",
        "description": "Interfaces are lighter than classes when you don't need methods"
      }
    },
    {
      "position": {
        "filePath": "src/services/api.ts",
        "startLine": 100
      },
      "message": "Potential security vulnerability: API key is exposed in client-side code.",
      "severity": "error"
    }
  ],
  "metadata": {
    "reviewedAt": "2024-01-15T10:30:00Z",
    "reviewer": "AI Code Reviewer v1.0"
  }
}
```

## Usage

### In GitLab CI Pipeline

```yaml
code_review:
  stage: review
  image: node:20
  script:
    # Install dependencies
    - npm install -g @thdk/gittai
    
    # AI tool generates review-results.json
    - ./run-ai-review.sh > review-results.json
    
    # Post comments to MR
    - gittai review-results.json
  only:
    - merge_requests
```

### Command Line

```bash
# Using environment variables (in CI)
export CI_PROJECT_ID="123"
export CI_MERGE_REQUEST_IID="456"
export CI_JOB_TOKEN="ci-token"
gittai review-results.json

# With explicit arguments
gittai --file review-results.json \
  --project-id 123 \
  --mr-iid 456 \
  --token glpat-xxxxx \
  --host https://gitlab.example.com
```

### Programmatic Usage

```typescript
import { 
  createGitlabClient, 
  readReviewResults, 
  fetchMergeRequestInfo,
  postReviewComments 
} from '@thdk/gittai';

const client = createGitlabClient({ token: 'your-token' });
const reviewResult = await readReviewResults('review-results.json');
const mrInfo = await fetchMergeRequestInfo(client, 'project-id', 123);
await postReviewComments(client, mrInfo, reviewResult);
```

## Design Decisions & Trade-offs

### 1. Line Range Calculation
**Decision**: Accept `startLine`/`endLine` and auto-generate GitLab's `lineCode` format
- **Pro**: Simpler for AI tools to output
- **Pro**: Encapsulates GitLab-specific format
- **Con**: Assumes all comments are on new/added lines (type: 'new')
- **Future**: Could add `oldLine` support for comments on deleted lines

### 2. Suggestion Offset Calculation
**Decision**: Auto-calculate offset (`:-X+Y`) based on line count difference
- **Pro**: Automatic and transparent
- **Pro**: Handles most common cases
- **Con**: Cannot handle complex cases where suggestion affects different line ranges
- **Future**: Could add explicit `linesRemoved`/`linesAdded` fields

### 3. Error Handling Strategy
**Decision**: Continue on failure, log errors, don't fail fast
- **Pro**: Posts as many comments as possible even if some fail
- **Pro**: Useful when files have been renamed/moved
- **Con**: Silent failures might be missed
- **Future**: Could add `--strict` mode to fail on first error

### 4. Comment Format
**Decision**: Include emoji and severity prefix by default
- **Pro**: Visual distinction in GitLab UI
- **Pro**: Matches common code review conventions
- **Con**: Might be too opinionated
- **Future**: Make configurable via options

### 5. Authentication Priority
**Decision**: CI Job Token > OAuth Token > Personal Access Token
- **Pro**: Secure by default in CI environments
- **Pro**: Automatically uses available credentials
- **Con**: Might be confusing if multiple tokens are set
- **Mitigation**: Clear documentation of precedence

## Future Enhancements

1. **Batch Operations**: Group multiple comments into fewer API calls to reduce rate limiting
2. **Idempotency**: Track posted comments to avoid duplicates on re-runs (could use comment body hash)
3. **Existing Discussion Resolution**: Automatically resolve old bot comments before posting new ones
4. **Diff Analysis**: Validate that commented lines actually exist in the diff
5. **Comment Filtering**: Support filtering by severity (e.g., only post errors/warnings)
6. **Parallel Posting**: Post comments concurrently with configurable concurrency limit
7. **Rich Formatting**: Support markdown tables, code blocks, links in messages
8. **Comment Grouping**: Group related comments into single discussion threads
9. **Old Line Support**: Handle comments on deleted/changed lines (using `oldLine` and `oldPath`)
10. **Image Position Type**: Support comments on image diffs (though rare in code reviews)

## Dependencies

- **zod**: ^3.23.8 - Schema validation
- **@gitbeaker/rest**: ^43.8.0 (workspace dependency) - GitLab API client
- **tslib**: ^2.8.1 - TypeScript runtime helpers

## Technical Considerations

### ESM Compatibility
- All imports use `.js` extensions (ESM requirement)
- `type: "module"` in package.json
- Node.js 18+ required for native ESM support

### TypeScript Configuration
- Strict mode enabled
- Composite project for incremental builds
- Declaration maps for debugging

### Testing Strategy
- Unit tests for schemas (edge cases, validation)
- Integration tests with mocked GitLab client
- Temp file handling for file I/O tests
- Error scenario coverage

### CI/CD Integration
- Automatic token detection from CI environment
- Fallback to manual token input
- Clear error messages for missing configuration
- Exit codes for CI success/failure detection

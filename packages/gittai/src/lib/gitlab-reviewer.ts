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
    newLine: String(comment.position.startLine),
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

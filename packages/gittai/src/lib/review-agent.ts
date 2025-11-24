import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ReviewResult, Severity } from './schemas/review-result.schema.js';

const execAsync = promisify(exec);

export interface ReviewAgentConfig {
  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  anthropicApiKey?: string;
  /** Model to use for review (defaults to claude-3-5-sonnet-20241022) */
  model?: string;
  /** Git repository path (defaults to current working directory) */
  repoPath?: string;
    /** Base URL for Anthropic API */
    baseURL?: string;
}

export interface ReviewRequest {
  /** Git branch to review */
  branch: string;
  /** Base branch to compare against (defaults to 'main') */
  baseBranch?: string;
  /** Specific files to review (if empty, reviews all changed files) */
  files?: string[];
  /** Review focus areas (e.g., 'security', 'performance', 'best-practices') */
  focusAreas?: string[];
}

/**
 * Perform a code review on the specified branch using MCP Agent
 */
export async function reviewCode(
  request: ReviewRequest,
  config: ReviewAgentConfig = {}
): Promise<ReviewResult> {
  const { branch, baseBranch = 'main', files, focusAreas } = request;
  const {
    anthropicApiKey = process.env.ANTHROPIC_API_KEY,
    model = 'claude-3-5-sonnet-20241022',
    baseURL = process.env.ANTHROPIC_API_BASE_URL,
  } = config;

  if (!anthropicApiKey) {
    throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY or pass anthropicApiKey option');
  }

  console.log(`Starting code review for branch: ${branch} (base: ${baseBranch})`);

  const { repoPath = process.cwd() } = config;

  // Get git diff
  console.log('Getting git diff...');
  
  // First, check if branches exist
  try {
    await execAsync(`git rev-parse --verify ${baseBranch}`, { cwd: repoPath });
  } catch {
    throw new Error(`Base branch "${baseBranch}" not found. Please specify a valid base branch with --base`);
  }
  
  try {
    await execAsync(`git rev-parse --verify ${branch}`, { cwd: repoPath });
  } catch {
    throw new Error(`Branch "${branch}" not found. Make sure you're on the correct branch or specify a valid branch with --branch`);
  }
  
  const { stdout: diff } = await execAsync(
    `git diff ${baseBranch}...${branch}`,
    { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
  );

  if (!diff.trim()) {
    console.log('No changes found');
    return {
      comments: [],
      metadata: {
        reviewedAt: new Date().toISOString(),
        reviewer: `gittai (${model})`,
        baseSha: baseBranch,
        headSha: branch,
      },
    };
  }

  // Filter diff by files if specified
  let filteredDiff = diff;
  if (files && files.length > 0) {
    // Extract only diffs for specified files
    const filePatterns = files.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`diff --git a/(${filePatterns}).*?(?=diff --git|$)`, 'gs');
    const matches = diff.match(regex);
    filteredDiff = matches ? matches.join('\n') : '';
    
    if (!filteredDiff.trim()) {
      console.log('No changes found in specified files');
      return {
        comments: [],
        metadata: {
          reviewedAt: new Date().toISOString(),
          reviewer: `gittai (${model})`,
          baseSha: baseBranch,
          headSha: branch,
        },
      };
    }
  }

  // Build the review prompt
  let prompt = `Review the following code changes and provide feedback.

`;

  if (focusAreas && focusAreas.length > 0) {
    prompt += `Focus areas: ${focusAreas.join(', ')}\n\n`;
  }

  prompt += `Here is the git diff:

\`\`\`diff
${filteredDiff}
\`\`\`

Provide your review as a JSON array with this exact structure (return ONLY the JSON, no markdown code blocks):
[
  {
    "position": {
      "filePath": "path/to/file.ts",
      "startLine": 42,
      "endLine": 45
    },
    "message": "Your review comment",
    "severity": "error",
    "suggestion": {
      "code": "suggested code",
      "description": "why this is better"
    }
  }
]

Review criteria:
- error: Critical bugs, logic errors, type errors, security vulnerabilities
- warning: Potential bugs, deprecated APIs, code smells
- info: General observations, documentation suggestions
- suggestion: Code improvements, refactoring opportunities

Use line numbers from the diff context. Be specific and actionable.`;

  console.log('Calling Claude API for review...');

  // Call Anthropic API
  const anthropic = new Anthropic({ apiKey: anthropicApiKey, baseURL });
  
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from API');
  }

  console.log('Parsing review results...');

  // Parse the response
  const comments = parseReviewResponse(content.text);

  console.log(`Review complete: found ${comments.length} comment(s)`);

  return {
    comments,
    metadata: {
      reviewedAt: new Date().toISOString(),
      reviewer: `gittai (${model})`,
      baseSha: baseBranch,
      headSha: branch,
    },
  };
}

/**
 * Parse the agent's response to extract review comments
 */
function parseReviewResponse(response: string): Array<{
  position: { filePath: string; startLine: number; endLine?: number };
  message: string;
  severity: Severity;
  suggestion?: { code: string; description?: string };
}> {
  const comments: Array<{
    position: { filePath: string; startLine: number; endLine?: number };
    message: string;
    severity: Severity;
    suggestion?: { code: string; description?: string };
  }> = [];

  // Try to extract JSON from the response
  try {
    // Look for JSON array in the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }

    // Try parsing the whole response as JSON
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.comments && Array.isArray(parsed.comments)) {
      return parsed.comments;
    }
  } catch {
    // Not valid JSON, return empty array
    console.warn('Could not parse review response as JSON');
  }

  return comments;
}

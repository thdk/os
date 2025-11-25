import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ReviewResultSchema, type ReviewResult, type Severity } from './schemas/review-result.schema.js';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod.js';
import assert from 'assert';

const execAsync = promisify(exec);

// Chunking limits for large diffs
const MAX_CHUNK_SIZE = 120_000; // ~30k tokens for claude-sonnet
const MAX_FILES_PER_CHUNK = 20;

// Default patterns to skip (generated files, lock files, minified code)
const DEFAULT_SKIP_PATTERNS = [
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  'dist/*',
  'build/*',
  'node_modules/*',
  'coverage/*',
  '*.generated.*',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.next/*',
  '.nuxt/*',
  'out/*',
  'target/*',
];

// Pricing per 1M tokens (as of Nov 2024)
const PRICING = {
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022-v2': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-4-sonnet': { input: 3.0, output: 15.0 },
} as const;

interface ReviewMetrics {
  filesReviewed: number;
  filesSkipped: number;
  chunksProcessed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  durationMs: number;
}

export interface ReviewAgentConfig {
  /** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  anthropicApiKey?: string;
  /** Model to use for review (defaults to claude-3-5-sonnet-20241022) */
  model?: string;
  /** Git repository path (defaults to current working directory) */
  repoPath?: string;
  /** Base URL for Anthropic API */
  baseURL?: string;
  /** Patterns to skip (uses minimatch, e.g., '*.lock', 'dist/*') */
  skipPatterns?: string[];
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

  // Split diff into individual file diffs
  const fileDiffs = splitDiffByFile(diff);
  
  // Apply skip patterns
  const { skipPatterns = DEFAULT_SKIP_PATTERNS } = config;
  const filteredByPattern = filterFilesByPattern(fileDiffs, skipPatterns);
  
  if (filteredByPattern.skipped.length > 0) {
    console.log(`Skipped ${filteredByPattern.skipped.length} file(s) matching skip patterns`);
  }
  
  // Filter by files if specified
  const targetFiles = files && files.length > 0 
    ? filteredByPattern.included.filter((fd: { filePath: string }) => files.some(f => fd.filePath.includes(f)))
    : filteredByPattern.included;
  
  if (targetFiles.length === 0) {
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
  
  console.log(`Found ${targetFiles.length} changed file(s)`);
  
  const startTime = Date.now();
  const metrics: ReviewMetrics = {
    filesReviewed: targetFiles.length,
    filesSkipped: filteredByPattern.skipped.length,
    chunksProcessed: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    durationMs: 0,
  };
  
  // Group files into chunks for review
  const chunks = chunkFileDiffs(targetFiles);
  console.log(`Split into ${chunks.length} chunk(s) for review`);
  
  // Review each chunk
  const allComments: Array<{
    position: { filePath: string; startLine: number; endLine?: number };
    message: string;
    severity: Severity;
    suggestion?: { code: string; description?: string };
  }> = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const estimatedTokens = estimateTokens(chunks[i].diff);
    console.log(`\nReviewing chunk ${i + 1}/${chunks.length} (${chunks[i].files.length} files, ${chunks[i].size.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens)...`);
    
    const chunkResult = await reviewChunk(
      chunks[i].diff,
      model,
      anthropicApiKey,
      baseURL,
      focusAreas
    );
    
    allComments.push(...chunkResult.comments);
    metrics.inputTokens += chunkResult.usage.input_tokens;
    metrics.outputTokens += chunkResult.usage.output_tokens;
    metrics.chunksProcessed++;
    
    console.log(`  Found ${chunkResult.comments.length} comment(s) | Tokens: ${chunkResult.usage.input_tokens} in, ${chunkResult.usage.output_tokens} out`);
  }
  
  metrics.durationMs = Date.now() - startTime;
  metrics.estimatedCost = calculateCost(model, metrics.inputTokens, metrics.outputTokens);

  console.log(`\n${'='.repeat(64)}`);
  console.log(`Review Summary:`);
  console.log(`${'='.repeat(64)}`);
  console.log(`Total comments:    ${allComments.length}`);
  console.log(`Files reviewed:    ${metrics.filesReviewed}`);
  console.log(`Files skipped:     ${metrics.filesSkipped}`);
  console.log(`Chunks processed:  ${metrics.chunksProcessed}`);
  console.log(`Input tokens:      ${metrics.inputTokens.toLocaleString()}`);
  console.log(`Output tokens:     ${metrics.outputTokens.toLocaleString()}`);
  console.log(`Estimated cost:    $${metrics.estimatedCost.toFixed(4)}`);
  console.log(`Duration:          ${(metrics.durationMs / 1000).toFixed(1)}s`);
  console.log(`${'='.repeat(64)}\n`);

  return {
    comments: allComments,
    metadata: {
      reviewedAt: new Date().toISOString(),
      reviewer: `gittai (${model})`,
      baseSha: baseBranch,
      headSha: branch,
    },
  };
}

/**
 * Check if a file path matches any of the skip patterns
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  });
}

/**
 * Filter files by skip patterns
 */
function filterFilesByPattern(
  fileDiffs: Array<{ filePath: string; diff: string; size: number }>,
  skipPatterns: string[]
): {
  included: Array<{ filePath: string; diff: string; size: number }>;
  skipped: Array<{ filePath: string; reason: string }>;
} {
  const included: Array<{ filePath: string; diff: string; size: number }> = [];
  const skipped: Array<{ filePath: string; reason: string }> = [];

  for (const fileDiff of fileDiffs) {
    if (matchesPattern(fileDiff.filePath, skipPatterns)) {
      skipped.push({ filePath: fileDiff.filePath, reason: 'matches skip pattern' });
    } else {
      included.push(fileDiff);
    }
  }

  return { included, skipped };
}

/**
 * Split diff into individual file diffs
 */
function splitDiffByFile(diff: string): Array<{ filePath: string; diff: string; size: number }> {
  const fileDiffs: Array<{ filePath: string; diff: string; size: number }> = [];
  
  // Match each file's diff block
  const fileRegex = /diff --git a\/(.*?) b\/.*?(?=(?:diff --git|$))/gs;
  let match;
  
  while ((match = fileRegex.exec(diff)) !== null) {
    const filePath = match[1];
    const fileDiff = match[0];
    fileDiffs.push({
      filePath,
      diff: fileDiff,
      size: fileDiff.length,
    });
  }
  
  return fileDiffs;
}

/**
 * Group file diffs into chunks that fit within token limits
 */
function chunkFileDiffs(
  fileDiffs: Array<{ filePath: string; diff: string; size: number }>
): Array<{ diff: string; files: string[]; size: number }> {
  const chunks: Array<{ diff: string; files: string[]; size: number }> = [];
  let currentChunk: { diff: string; files: string[]; size: number } = {
    diff: '',
    files: [],
    size: 0,
  };
  
  for (const fileDiff of fileDiffs) {
    // If adding this file would exceed limits, start a new chunk
    if (
      (currentChunk.size + fileDiff.size > MAX_CHUNK_SIZE ||
        currentChunk.files.length >= MAX_FILES_PER_CHUNK) &&
      currentChunk.files.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = { diff: '', files: [], size: 0 };
    }
    
    currentChunk.diff += fileDiff.diff + '\n';
    currentChunk.files.push(fileDiff.filePath);
    currentChunk.size += fileDiff.size;
  }
  
  // Add the last chunk if it has content
  if (currentChunk.files.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Estimate tokens in text (rough approximation: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate cost based on model and token usage
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['claude-3-5-sonnet-20241022'];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Review a single chunk of diffs
 */
async function reviewChunk(
  diffChunk: string,
  model: string,
  apiKey: string,
  baseURL: string | undefined,
  focusAreas?: string[]
): Promise<{
  comments: Array<{
    position: { filePath: string; startLine: number; endLine?: number };
    message: string;
    severity: Severity;
    suggestion?: { code: string; description?: string };
  }>;
  usage: { input_tokens: number; output_tokens: number };
}> {
  // Build the review prompt
  let prompt = `Review the following code changes and provide feedback.\n\n`;

  if (focusAreas && focusAreas.length > 0) {
    prompt += `Focus areas: ${focusAreas.join(', ')}\n\n`;
  }

  prompt += `Here is the git diff:

\`\`\`diff
${diffChunk}
\`\`\`

Review criteria:
- error: Critical bugs, logic errors, type errors, security vulnerabilities
- warning: Potential bugs, deprecated APIs, code smells
- info: General observations, documentation suggestions
- suggestion: Code improvements, refactoring opportunities

Use line numbers from the diff context. Be specific and actionable. Focus on the most important issues.`;

  // Call Anthropic API
  const client = new Anthropic({ apiKey, baseURL });

  const response = await client.beta.messages.parse({
    model,
    max_tokens: 4096,
    betas: ["structured-outputs-2025-11-13"],
    output_format: betaZodOutputFormat(ReviewResultSchema),
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.parsed_output;

  // Parse the response
  const comments = content?.comments

  assert(comments, 'No comments found in review response');
  
  return {
    comments,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

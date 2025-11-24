#!/usr/bin/env node

import { reviewCode } from '../lib/review-agent.js';
import { writeFile } from 'fs/promises';
import { exit } from 'process';
import { resolve } from 'path';

interface CLIArgs {
  branch: string;
  baseBranch?: string;
  output?: string;
  files?: string[];
  focusAreas?: string[];
  apiKey?: string;
  model?: string;
  repoPath?: string;
  baseURL?: string;
  skipPatterns?: string[];
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  
  const parsed: CLIArgs = {
    branch: '',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--branch':
      case '-b':
        parsed.branch = nextArg;
        i++;
        break;
      case '--base':
        parsed.baseBranch = nextArg;
        i++;
        break;
      case '--output':
      case '-o':
        parsed.output = nextArg;
        i++;
        break;
      case '--files':
      case '-f':
        parsed.files = nextArg.split(',').map(f => f.trim());
        i++;
        break;
      case '--focus':
        parsed.focusAreas = nextArg.split(',').map(f => f.trim());
        i++;
        break;
      case '--repo-path':
        parsed.repoPath = nextArg;
        i++;
        break;
      case '--api-key':
        parsed.apiKey = nextArg;
        i++;
        break;
      case '--model':
        parsed.model = nextArg;
        i++;
        break;
      case '--base-url':
        parsed.baseURL = nextArg;
        i++;
        break;
      case '--skip-patterns':
        parsed.skipPatterns = nextArg.split(',').map(p => p.trim());
        i++;
        break;
      case '--help':
      case '-h':
        printUsage();
        exit(0);
      default:
        // Treat as branch if no branch specified yet
        if (!parsed.branch) {
          parsed.branch = arg;
        }
        break;
    }
  }
  
  return parsed;
}

function printUsage(): void {
  console.log(`
Usage: gittai-review [options] <branch>

Perform AI-powered code review on a Git branch using Claude.

Options:
  -b, --branch <name>         Branch to review (required)
  --base <name>               Base branch to compare against (default: main)
  -o, --output <path>         Output file for review results (default: review-results.json)
  -f, --files <paths>         Comma-separated list of files to review (default: all changed files)
  --focus <areas>             Comma-separated focus areas (e.g., security,performance)
  --repo-path <path>          Path to git repository (default: current directory)
  --skip-patterns <patterns>  Comma-separated patterns to skip (e.g., '*.lock,dist/*')
  --api-key <key>             Anthropic API key (default: ANTHROPIC_API_KEY env)
  --model <name>              Model to use (default: claude-3-5-sonnet-20241022)
  --base-url <url>            Custom API base URL (for proxies)
  -h, --help                  Show this help message

Environment Variables:
  ANTHROPIC_API_KEY           Anthropic API key (required if not passed via --api-key)
  CI_MERGE_REQUEST_SOURCE_BRANCH_NAME  GitLab CI: source branch name
  CI_PROJECT_DIR              GitLab CI: project directory

Examples:
  # Review a feature branch
  gittai review feature-branch

  # Review with specific base branch
  gittai review --branch feature-123 --base develop

  # Review specific files only
  gittai review feature-branch --files src/auth.ts,src/user.ts

  # Focus on security and performance
  gittai review feature-branch --focus security,performance

  # Custom output file
  gittai review feature-branch --output my-review.json

  # In GitLab CI
  gittai review $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME

Complete Workflow:
  # 1. Review the code
  gittai review feature-branch --output review-results.json
  
  # 2. Post comments to GitLab MR
  gittai post review-results.json
`);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();
    
    // Validate required arguments
    if (!args.branch) {
      // Try CI environment variable
      args.branch = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || '';
      
      if (!args.branch) {
        console.error('Error: Branch name is required\n');
        printUsage();
        exit(1);
      }
    }
    
    const outputPath = args.output || 'review-results.json';
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   GitTAI Code Review                         ║
╚══════════════════════════════════════════════════════════════╝

Branch:        ${args.branch}
Base:          ${args.baseBranch || 'main'}
Output:        ${outputPath}
Repo Path:     ${args.repoPath || process.cwd()}
Base URL:      ${args.baseURL || process.env.ANTHROPIC_API_BASE_URL || 'default'}
Model:         ${args.model || 'claude-3-5-sonnet-20241022'}
`);
    
    if (args.files && args.files.length > 0) {
      console.log(`Files:         ${args.files.join(', ')}`);
    }
    
    if (args.focusAreas && args.focusAreas.length > 0) {
      console.log(`Focus:         ${args.focusAreas.join(', ')}`);
    }
    
    console.log('\n' + '─'.repeat(64) + '\n');
    
    // Perform review
    const result = await reviewCode(
      {
        branch: args.branch,
        baseBranch: args.baseBranch,
        files: args.files,
        focusAreas: args.focusAreas,
      },
      {
        repoPath: args.repoPath,
        anthropicApiKey: args.apiKey,
        model: args.model,
        baseURL: args.baseURL,
        skipPatterns: args.skipPatterns,
      }
    );
    
    // Write results to file
    const outputFullPath = resolve(process.cwd(), outputPath);
    await writeFile(outputFullPath, JSON.stringify(result, null, 2), 'utf-8');
    
    console.log('\n' + '─'.repeat(64));
    console.log(`
✓ Review complete!

Results:       ${result.comments.length} comment(s) found
Output:        ${outputFullPath}

Severity breakdown:
  Errors:      ${result.comments.filter(c => c.severity === 'error').length}
  Warnings:    ${result.comments.filter(c => c.severity === 'warning').length}
  Info:        ${result.comments.filter(c => c.severity === 'info').length}
  Suggestions: ${result.comments.filter(c => c.severity === 'suggestion').length}
`);
    
    if (result.comments.length > 0) {
      console.log('Next step: Post comments to GitLab MR');
      console.log(`  gittai post ${outputPath}\n`);
    }
    
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

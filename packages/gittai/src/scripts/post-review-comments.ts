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
      case '-h': {
        printUsage();
        break;
      }
      default:
        // Treat as file path if no file specified yet
        if (!parsed.reviewResultsFile) {
          parsed.reviewResultsFile = arg;
        }
        break;
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

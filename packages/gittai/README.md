# @thdk/gittai

GitLab AI code review automation - AI-powered code review with MCP integration and automated comment posting to GitLab merge requests.

## Features

- 🤖 **AI-Powered Code Review**: Automated code review using Claude with MCP (Model Context Protocol)
- 🔧 **Git Operations**: Native git integration via MCP servers (diff, log, status)
- 📁 **File System Access**: Read and analyze files through MCP filesystem server
- 📍 **Inline Comments**: Single-line and multi-line inline comments on GitLab MRs
- 💡 **Smart Suggestions**: GitLab suggestion blocks with automatic code replacement
- 🎯 **Severity Levels**: error, warning, info, suggestion with emoji indicators
- 🔐 **Flexible Auth**: Personal Access Tokens (PAT) and CI Job Tokens
- ✅ **Type-Safe**: Full TypeScript support with Zod schemas
- 🧪 **Tested**: Comprehensive test coverage

## Installation

```bash
npm install @thdk/gittai
# or
yarn add @thdk/gittai
```

## Quick Start

### Complete Workflow

```bash
# 1. Configure MCP servers (one-time setup)
cp node_modules/@thdk/gittai/.mcp.json.example .mcp.json

# 2. Review your code with AI
gittai-review feature-branch --output review-results.json

# 3. Post comments to GitLab MR
gittai review-results.json
```

## Usage

### AI Code Review (`gittai-review`)

Perform AI-powered code review using Claude with MCP integration:

```bash
# Review a feature branch
gittai-review feature-branch

# Review with specific base branch
gittai-review --branch feature-123 --base develop

# Review specific files only
gittai-review feature-branch --files src/auth.ts,src/user.ts

# Focus on specific areas
gittai-review feature-branch --focus security,performance

# Custom output file
gittai-review feature-branch --output my-review.json

# In GitLab CI
gittai-review $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME
```

#### Review Command Options

- `-b, --branch <name>` - Branch to review (required)
- `--base <name>` - Base branch to compare against (default: main)
- `-o, --output <path>` - Output file for review results (default: review-results.json)
- `-f, --files <paths>` - Comma-separated list of files to review (default: all changed)
- `--focus <areas>` - Focus areas (e.g., security,performance,best-practices)
- `--mcp-config <path>` - Path to .mcp.json config file (default: .mcp.json)
- `--api-key <key>` - Anthropic API key (default: ANTHROPIC_API_KEY env)
- `--model <name>` - Model to use (default: claude-sonnet-4-20250514)
- `-h, --help` - Show help message

### Post Comments (`gittai`)

The package provides a `gittai` CLI command to post review comments from a JSON file:

```bash
# In GitLab CI (uses CI environment variables automatically)
gittai review-results.json

# With explicit arguments
gittai --file review-results.json \
  --project-id 123 \
  --mr-iid 456 \
  --token glpat-xxxxx

# Using job token (for CI/CD)
gittai review-results.json --job-token $CI_JOB_TOKEN
```

#### CLI Options

- `-f, --file <path>` - Path to review results JSON file
- `-p, --project-id <id>` - GitLab project ID (default: `CI_PROJECT_ID` env)
- `-m, --mr-iid <number>` - Merge request IID (default: `CI_MERGE_REQUEST_IID` env)
- `-t, --token <token>` - GitLab personal access token (default: `GITLAB_TOKEN` env)
- `--job-token <token>` - GitLab CI job token (default: `CI_JOB_TOKEN` env)
- `--host <url>` - GitLab host URL (default: `CI_SERVER_URL` or https://gitlab.com)
- `-h, --help` - Show help message

### Programmatic Usage

#### Review Code with AI

```typescript
import { reviewCode } from '@thdk/gittai';

// Perform AI code review
const result = await reviewCode(
  {
    branch: 'feature-branch',
    baseBranch: 'main',
    files: ['src/auth.ts', 'src/user.ts'], // optional
    focusAreas: ['security', 'performance'], // optional
  },
  {
    mcpConfigPath: '.mcp.json',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
  }
);

console.log(`Found ${result.comments.length} comments`);
```

#### Post Comments to GitLab

```typescript
import { 
  createGitlabClient, 
  readReviewResults, 
  fetchMergeRequestInfo,
  postReviewComments 
} from '@thdk/gittai';

// Create GitLab client
const client = createGitlabClient({ 
  token: 'your-token',
  host: 'https://gitlab.example.com' // optional
});

// Or use environment variables
const client = createGitlabClientFromEnv();

// Read and validate review results
const reviewResult = await readReviewResults('review-results.json');

// Fetch MR details (to get commit SHAs)
const mrInfo = await fetchMergeRequestInfo(client, 'project-id', 123);

// Post comments
await postReviewComments(client, mrInfo, reviewResult);
```

## Review Results JSON Format

The review results file should follow this schema:

```typescript
{
  comments: Array<{
    position: {
      filePath: string;           // File path relative to repo root
      startLine: number;           // Starting line (1-indexed)
      endLine?: number;            // Optional ending line for multi-line
    };
    message: string;               // The review comment message
    severity: 'error' | 'warning' | 'info' | 'suggestion';  // Default: 'info'
    suggestion?: {                 // Optional code suggestion
      code: string;                // Suggested code replacement
      description?: string;        // Optional explanation
    };
  }>;
  metadata?: {                     // Optional metadata
    baseSha?: string;              // Base commit SHA
    headSha?: string;              // Head commit SHA
    reviewedAt?: string;           // ISO timestamp
    reviewer?: string;             // Reviewer identifier
  };
}
```

### Example Review Results

See [example-review-results.json](./example-review-results.json) for a complete example.

```json
{
  "comments": [
    {
      "position": {
        "filePath": "src/utils/auth.ts",
        "startLine": 42
      },
      "message": "This function lacks input validation.",
      "severity": "warning"
    },
    {
      "position": {
        "filePath": "src/models/user.ts",
        "startLine": 15,
        "endLine": 25
      },
      "message": "Consider using an interface instead.",
      "severity": "suggestion",
      "suggestion": {
        "code": "interface User {\n  id: string;\n  name: string;\n}",
        "description": "Interfaces are lighter than classes"
      }
    }
  ]
}
```

## MCP Configuration

Create a `.mcp.json` file to configure MCP servers for git operations and file system access:

```json
{
  "mcpServers": {
    "git": {
      "command": "npx",
      "args": ["-y", "git-mcp-server@latest"],
      "env": {
        "ALLOWED_OPERATIONS": "read,log,diff,show,status",
        "REPO_PATH": "${CI_PROJECT_DIR}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "${CI_PROJECT_DIR}"],
      "env": {}
    }
  }
}
```

Copy the example configuration:
```bash
cp node_modules/@thdk/gittai/.mcp.json.example .mcp.json
```

### MCP Servers Used

- **git-mcp-server**: 27 git operations (diff, log, show, status, etc.)
- **@modelcontextprotocol/server-filesystem**: Read files and directory structures

## GitLab CI/CD Integration

Add this to your `.gitlab-ci.yml`:

```yaml
code_review:
  stage: review
  image: node:20
  script:
    # Install gittai
    - npm install -g @thdk/gittai
    
    # Run AI review (requires ANTHROPIC_API_KEY)
    - gittai-review $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME --output review-results.json
    
    # Post comments to MR
    - gittai review-results.json
  only:
    - merge_requests
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY  # Set in GitLab CI/CD variables
```

The scripts automatically use these GitLab CI environment variables:
- `CI_PROJECT_ID` - Project ID
- `CI_MERGE_REQUEST_IID` - MR IID
- `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` - Source branch name
- `CI_JOB_TOKEN` - Job token (preferred) or `GITLAB_TOKEN`
- `CI_SERVER_URL` - GitLab server URL
- `CI_PROJECT_DIR` - Project directory path

## Comment Features

### Severity Indicators

Comments are prefixed with emoji and severity level:
- 🚨 **ERROR** - Critical issues
- ⚠️ **WARNING** - Important warnings
- ℹ️ **INFO** - Informational notes
- 💡 **SUGGESTION** - Code improvement suggestions

### Code Suggestions

When a comment includes a `suggestion` field, it's formatted using GitLab's suggestion syntax:

````markdown
💡 **SUGGESTION**

Consider using const instead of let

Interfaces are lighter than classes

```suggestion
const value = 42;
```
````

Users can apply suggestions directly from the GitLab UI with one click.

### Multi-line Comments

Comments with both `startLine` and `endLine` will highlight the entire range in the MR diff view.

## API Reference

### Review Agent

```typescript
import {
  reviewCode,
  createReviewAgent,
  type ReviewAgentConfig,
  type ReviewRequest,
} from '@thdk/gittai';

// Perform code review
const result = await reviewCode(request, config);

// Create custom review agent
const agent = await createReviewAgent(config);
```

### Schema Exports

```typescript
import {
  ReviewResult,
  ReviewComment,
  CommentPosition,
  CodeSuggestion,
  Severity,
  ReviewResultSchema,
  validateReviewResult,
  safeValidateReviewResult,
} from '@thdk/gittai';
```

### Client Functions

```typescript
import {
  createGitlabClient,
  createGitlabClientFromEnv,
  type GitlabClientConfig,
} from '@thdk/gittai';
```

### Reviewer Functions

```typescript
import {
  readReviewResults,
  postReviewComments,
  fetchMergeRequestInfo,
  type MergeRequestInfo,
  type PostReviewOptions,
} from '@thdk/gittai';
```

## Development

### Building

Run `nx build gittai` to build the library.

### Running Tests

Run `nx test gittai` to execute the unit tests via [Jest](https://jestjs.io).

### Type Checking

Run `nx typecheck gittai` to run TypeScript type checking.

### Linting

Run `nx lint gittai` to run ESLint.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

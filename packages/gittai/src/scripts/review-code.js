#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var review_agent_js_1 = require("../lib/review-agent.js");
var promises_1 = require("fs/promises");
var process_1 = require("process");
var path_1 = require("path");
function parseArgs() {
    var args = process.argv.slice(2);
    var parsed = {
        branch: '',
    };
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        var nextArg = args[i + 1];
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
                parsed.files = nextArg.split(',').map(function (f) { return f.trim(); });
                i++;
                break;
            case '--focus':
                parsed.focusAreas = nextArg.split(',').map(function (f) { return f.trim(); });
                i++;
                break;
            case '--mcp-config':
                parsed.mcpConfig = nextArg;
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
            case '--help':
            case '-h':
                printUsage();
                (0, process_1.exit)(0);
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
function printUsage() {
    console.log("\nUsage: gittai review [options] <branch>\n\nPerform AI-powered code review on a Git branch using MCP (Model Context Protocol).\n\nOptions:\n  -b, --branch <name>         Branch to review (required)\n  --base <name>               Base branch to compare against (default: main)\n  -o, --output <path>         Output file for review results (default: review-results.json)\n  -f, --files <paths>         Comma-separated list of files to review (default: all changed files)\n  --focus <areas>             Comma-separated focus areas (e.g., security,performance)\n  --mcp-config <path>         Path to .mcp.json config file (default: .mcp.json)\n  --api-key <key>             Anthropic API key (default: ANTHROPIC_API_KEY env)\n  --model <name>              Model to use (default: claude-sonnet-4-20250514)\n  -h, --help                  Show this help message\n\nMCP Configuration:\n  Create a .mcp.json file to configure MCP servers (git, filesystem, etc.)\n  See .mcp.json.example for a template.\n\nEnvironment Variables:\n  ANTHROPIC_API_KEY           Anthropic API key (required if not passed via --api-key)\n  CI_MERGE_REQUEST_SOURCE_BRANCH_NAME  GitLab CI: source branch name\n  CI_PROJECT_DIR              GitLab CI: project directory\n\nExamples:\n  # Review a feature branch\n  gittai review feature-branch\n\n  # Review with specific base branch\n  gittai review --branch feature-123 --base develop\n\n  # Review specific files only\n  gittai review feature-branch --files src/auth.ts,src/user.ts\n\n  # Focus on security and performance\n  gittai review feature-branch --focus security,performance\n\n  # Custom output file\n  gittai review feature-branch --output my-review.json\n\n  # In GitLab CI\n  gittai review $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME\n\nComplete Workflow:\n  # 1. Review the code\n  gittai review feature-branch --output review-results.json\n  \n  # 2. Post comments to GitLab MR\n  gittai post review-results.json\n");
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var args, outputPath, result, outputFullPath, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    args = parseArgs();
                    // Validate required arguments
                    if (!args.branch) {
                        // Try CI environment variable
                        args.branch = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || '';
                        if (!args.branch) {
                            console.error('Error: Branch name is required\n');
                            printUsage();
                            (0, process_1.exit)(1);
                        }
                    }
                    outputPath = args.output || 'review-results.json';
                    console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\n\u2551                   GitTAI Code Review                         \u2551\n\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n\nBranch:        ".concat(args.branch, "\nBase:          ").concat(args.baseBranch || 'main', "\nOutput:        ").concat(outputPath, "\nMCP Config:    ").concat(args.mcpConfig || '.mcp.json', "\nModel:         ").concat(args.model || 'claude-sonnet-4-20250514', "\n"));
                    if (args.files && args.files.length > 0) {
                        console.log("Files:         ".concat(args.files.join(', ')));
                    }
                    if (args.focusAreas && args.focusAreas.length > 0) {
                        console.log("Focus:         ".concat(args.focusAreas.join(', ')));
                    }
                    console.log('\n' + '─'.repeat(64) + '\n');
                    return [4 /*yield*/, (0, review_agent_js_1.reviewCode)({
                            branch: args.branch,
                            baseBranch: args.baseBranch,
                            files: args.files,
                            focusAreas: args.focusAreas,
                        }, {
                            mcpConfigPath: args.mcpConfig,
                            anthropicApiKey: args.apiKey,
                            model: args.model,
                        })];
                case 1:
                    result = _a.sent();
                    outputFullPath = (0, path_1.resolve)(process.cwd(), outputPath);
                    return [4 /*yield*/, (0, promises_1.writeFile)(outputFullPath, JSON.stringify(result, null, 2), 'utf-8')];
                case 2:
                    _a.sent();
                    console.log('\n' + '─'.repeat(64));
                    console.log("\n\u2713 Review complete!\n\nResults:       ".concat(result.comments.length, " comment(s) found\nOutput:        ").concat(outputFullPath, "\n\nSeverity breakdown:\n  Errors:      ").concat(result.comments.filter(function (c) { return c.severity === 'error'; }).length, "\n  Warnings:    ").concat(result.comments.filter(function (c) { return c.severity === 'warning'; }).length, "\n  Info:        ").concat(result.comments.filter(function (c) { return c.severity === 'info'; }).length, "\n  Suggestions: ").concat(result.comments.filter(function (c) { return c.severity === 'suggestion'; }).length, "\n"));
                    if (result.comments.length > 0) {
                        console.log('Next step: Post comments to GitLab MR');
                        console.log("  gittai post ".concat(outputPath, "\n"));
                    }
                    (0, process_1.exit)(0);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('\n✗ Error:', error_1 instanceof Error ? error_1.message : String(error_1));
                    if (error_1 instanceof Error && error_1.stack) {
                        console.error('\nStack trace:', error_1.stack);
                    }
                    (0, process_1.exit)(1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
main();

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
exports.reviewCode = reviewCode;
var anthropic_1 = require("@langchain/anthropic");
var mcp_use_1 = require("mcp-use");
var promises_1 = require("fs/promises");
var path_1 = require("path");
/**
 * Perform a code review on the specified branch using MCP Agent
 */
function reviewCode(request_1) {
    return __awaiter(this, arguments, void 0, function (request, config) {
        var branch, _a, baseBranch, files, focusAreas, _b, mcpConfigPath, _c, anthropicApiKey, _d, model, _e, maxSteps, configPath, mcpConfig, configContent, error_1, client, llm, agent, prompt_1, result, comments;
        if (config === void 0) { config = {}; }
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    branch = request.branch, _a = request.baseBranch, baseBranch = _a === void 0 ? 'main' : _a, files = request.files, focusAreas = request.focusAreas;
                    _b = config.mcpConfigPath, mcpConfigPath = _b === void 0 ? '.mcp.json' : _b, _c = config.anthropicApiKey, anthropicApiKey = _c === void 0 ? process.env.ANTHROPIC_API_KEY : _c, _d = config.model, model = _d === void 0 ? 'claude-3-5-sonnet-20241022' : _d, _e = config.maxSteps, maxSteps = _e === void 0 ? 20 : _e;
                    if (!anthropicApiKey) {
                        throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY or pass anthropicApiKey option');
                    }
                    console.log("Starting code review for branch: ".concat(branch, " (base: ").concat(baseBranch, ")"));
                    configPath = (0, path_1.resolve)(process.cwd(), mcpConfigPath);
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(configPath, 'utf-8')];
                case 2:
                    configContent = _f.sent();
                    mcpConfig = JSON.parse(configContent);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _f.sent();
                    throw new Error("Failed to load MCP config from ".concat(configPath, ": ").concat(error_1 instanceof Error ? error_1.message : String(error_1), "\n") +
                        "Create a .mcp.json file with your MCP server configuration.");
                case 4:
                    client = mcp_use_1.MCPClient.fromDict(mcpConfig);
                    llm = new anthropic_1.ChatAnthropic({
                        apiKey: anthropicApiKey,
                        model: model,
                    });
                    agent = new mcp_use_1.MCPAgent({ llm: llm, client: client, maxSteps: maxSteps });
                    _f.label = 5;
                case 5:
                    _f.trys.push([5, , 7, 9]);
                    prompt_1 = "Review the code changes in branch \"".concat(branch, "\" compared to \"").concat(baseBranch, "\".\n\nUse the git tools to:\n1. Get the diff between ").concat(baseBranch, " and ").concat(branch, "\n2. Analyze the changes");
                    if (files && files.length > 0) {
                        prompt_1 += "\n3. Focus only on these files: ".concat(files.join(', '));
                    }
                    if (focusAreas && focusAreas.length > 0) {
                        prompt_1 += "\n\nFocus areas: ".concat(focusAreas.join(', '));
                    }
                    prompt_1 += "\n\nProvide your review as a JSON array with this exact structure (return ONLY the JSON, no markdown or explanations):\n[\n  {\n    \"position\": {\n      \"filePath\": \"path/to/file.ts\",\n      \"startLine\": 42,\n      \"endLine\": 45\n    },\n    \"message\": \"Your review comment\",\n    \"severity\": \"error\",\n    \"suggestion\": {\n      \"code\": \"suggested code\",\n      \"description\": \"why this is better\"\n    }\n  }\n]\n\nReview criteria:\n- Errors: Critical bugs, logic errors, type errors\n- Warnings: Potential bugs, deprecated APIs, security concerns\n- Info: General observations, documentation notes\n- Suggestions: Code improvements, refactoring opportunities\n\nBe specific with line numbers and file paths.";
                    console.log('Running AI code review agent...');
                    return [4 /*yield*/, agent.run(prompt_1, maxSteps)];
                case 6:
                    result = _f.sent();
                    console.log('Agent execution complete, parsing results...');
                    comments = parseReviewResponse(result);
                    console.log("Review complete: found ".concat(comments.length, " comment(s)"));
                    return [2 /*return*/, {
                            comments: comments,
                            metadata: {
                                reviewedAt: new Date().toISOString(),
                                reviewer: "gittai-mcp (".concat(model, ")"),
                                baseSha: baseBranch,
                                headSha: branch,
                            },
                        }];
                case 7: 
                // Close MCP sessions
                return [4 /*yield*/, client.closeAllSessions()];
                case 8:
                    // Close MCP sessions
                    _f.sent();
                    return [7 /*endfinally*/];
                case 9: return [2 /*return*/];
            }
        });
    });
}
/**
 * Parse the agent's response to extract review comments
 */
function parseReviewResponse(response) {
    var comments = [];
    // Try to extract JSON from the response
    try {
        // Look for JSON array in the response
        var jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            var parsed_1 = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed_1)) {
                return parsed_1;
            }
        }
        // Try parsing the whole response as JSON
        var parsed = JSON.parse(response);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        if (parsed.comments && Array.isArray(parsed.comments)) {
            return parsed.comments;
        }
    }
    catch (_a) {
        // Not valid JSON, return empty array
        console.warn('Could not parse review response as JSON');
    }
    return comments;
}

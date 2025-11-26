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

// Export review agent
export { reviewCode } from './lib/review-agent.js';
export type { ReviewAgentConfig, ReviewRequest } from './lib/review-agent.js';



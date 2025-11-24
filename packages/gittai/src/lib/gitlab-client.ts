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

  // adda a comment
  
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

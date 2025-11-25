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
  
  // Determine host
  const gitlabHost = host || process.env.CI_SERVER_URL || 'https://gitlab.com';
  
  // Determine authentication method
  if (token) {
    console.log('🔑 Using Personal Access Token for authentication');
    return new Gitlab({
      host: gitlabHost,
      token,
    });
  }
  
  if (jobToken) {
    console.log('🔑 Using CI Job Token for authentication');
    return new Gitlab({
      host: gitlabHost,
      jobToken,
    });
  }
  
  if (oauthToken) {
    console.log('🔑 Using OAuth token for authentication');
    return new Gitlab({
      host: gitlabHost,
      oauthToken,
    });
  }
  
  
  throw new Error(
    'No authentication method provided. Please provide one of: token, jobToken, or oauthToken'
  );
}

export function createGitlabClientFromEnv(): Gitlab {
    return createGitlabClient({
      token: process.env.GITLAB_TOKEN,
      jobToken: process.env.CI_JOB_TOKEN,
    });
}

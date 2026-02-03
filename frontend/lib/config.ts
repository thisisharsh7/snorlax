/**
 * Application configuration
 *
 * Centralized configuration for API endpoints and other settings.
 * Uses environment variables for production flexibility.
 */

// Backend API URL
// In production, set NEXT_PUBLIC_API_URL environment variable
// Example: NEXT_PUBLIC_API_URL=https://api.yourdomain.com
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Helper function to build API URLs
export function apiUrl(path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

// Common API endpoints
export const API_ENDPOINTS = {
  // Repository management
  index: () => apiUrl('/api/index'),
  repositories: () => apiUrl('/api/repositories'),
  reindex: (projectId: string) => apiUrl(`/api/reindex/${projectId}`),
  status: (projectId: string) => apiUrl(`/api/status/${projectId}`),
  deleteRepo: (projectId: string) => apiUrl(`/api/repositories/${projectId}`),

  // GitHub integration
  validateToken: () => apiUrl('/api/github/validate-token'),
  importIssues: (projectId: string) => apiUrl(`/api/github/import-issues/${projectId}`),
  importPRs: (projectId: string) => apiUrl(`/api/github/import-prs/${projectId}`),
  importInitial: (projectId: string) => apiUrl(`/api/github/import-initial/${projectId}`),
  syncStatus: (projectId: string) => apiUrl(`/api/github/sync-status/${projectId}`),
  githubIssues: (projectId: string) => apiUrl(`/api/github/issues/${projectId}`),
  githubPRs: (projectId: string) => apiUrl(`/api/github/prs/${projectId}`),
  postComment: (projectId: string, issueNumber: number) => apiUrl(`/api/github/post-comment/${projectId}/${issueNumber}`),

  // Settings
  settings: () => apiUrl('/api/settings'),

  // Categorization
  categorizeIssues: (projectId: string) => apiUrl(`/api/categorize-issues/${projectId}`),
  categorizedIssues: (projectId: string) => apiUrl(`/api/categorized-issues/${projectId}`),

  // Triage
  triageDashboard: (projectId: string) => apiUrl(`/api/triage/dashboard/${projectId}`),
  triageUncategorized: (projectId: string) => apiUrl(`/api/triage/issues/${projectId}/uncategorized`),
  triageIssuesWithTriage: (projectId: string, state?: string) => apiUrl(`/api/triage/issues-with-triage/${projectId}${state ? `?state=${state}` : ''}`),
  triageAnalyze: (projectId: string, issueNumber: number) => apiUrl(`/api/triage/analyze/${projectId}/${issueNumber}`),
  triageBatch: (projectId: string) => apiUrl(`/api/triage/batch-triage/${projectId}`),
  triageBatchStatus: (projectId: string) => apiUrl(`/api/triage/batch-status/${projectId}`),
  triageIssue: (projectId: string, issueNumber: number) => apiUrl(`/api/triage/issue/${projectId}/${issueNumber}`),
  triageSearchSemantic: (projectId: string) => apiUrl(`/api/triage/search-semantic/${projectId}`),

  // Webhooks
  webhookEndpoint: () => apiUrl('/api/webhooks/github'),
  webhookSetupInstructions: () => apiUrl('/api/webhooks/setup-instructions'),

  // Additional endpoints
  categoryStats: (projectId: string) => apiUrl(`/api/category-stats/${projectId}`),
  generateComment: (projectId: string, issueNumber: number, category: string) =>
    apiUrl(`/api/generate-comment/${projectId}/${issueNumber}?category=${category}`),
  issueDetail: (projectId: string, issueNumber: number) => apiUrl(`/api/github/issue-detail/${projectId}/${issueNumber}`),
}

export default {
  API_BASE_URL,
  apiUrl,
  API_ENDPOINTS,
}

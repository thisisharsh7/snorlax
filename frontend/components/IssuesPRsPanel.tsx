'use client'

import { useState, useEffect } from 'react'

interface Issue {
  number: number
  title: string
  state: string
  author: string
  created_at: string
  updated_at: string
  labels: string[]
  html_url: string
  body: string
}

interface PullRequest {
  number: number
  title: string
  state: string
  author: string
  created_at: string
  updated_at: string
  merged_at: string | null
  labels: string[]
  html_url: string
  body: string
}

interface IssuesPRsPanelProps {
  projectId: string
  repoName: string
  lastSyncedAt: string | null
  onImport: () => void
  onOpenSettings: () => void
  onReindex: () => void
}

export default function IssuesPRsPanel({ projectId, repoName, lastSyncedAt, onImport, onOpenSettings, onReindex }: IssuesPRsPanelProps) {
  const [activeTab, setActiveTab] = useState<'issues' | 'prs'>('issues')
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [prFilter, setPrFilter] = useState<'all' | 'open' | 'closed' | 'merged'>('all')
  const [issues, setIssues] = useState<Issue[]>([])
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState(false)
  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [showTokenPrompt, setShowTokenPrompt] = useState(false)

  useEffect(() => {
    checkGithubToken()
    if (activeTab === 'issues') {
      loadIssues()
    } else {
      loadPRs()
    }
  }, [projectId, activeTab, issueFilter, prFilter])

  async function checkGithubToken() {
    try {
      const res = await fetch('http://localhost:8000/api/settings')
      const data = await res.json()
      setHasGithubToken(data.github_token_set)
    } catch (e) {
      console.error('Failed to check GitHub token:', e)
    }
  }

  async function loadIssues() {
    setLoading(true)
    setError(null)
    try {
      const stateParam = issueFilter === 'all' ? '' : `?state=${issueFilter}`
      const res = await fetch(`http://localhost:8000/api/github/issues/${projectId}${stateParam}`)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load issues')
      }

      const data = await res.json()
      setIssues(data.issues || [])
    } catch (e: any) {
      console.error('Failed to load issues:', e)
      setError(e.message || 'Failed to load issues. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function loadPRs() {
    setLoading(true)
    setError(null)
    try {
      const stateParam = prFilter === 'all' ? '' : `?state=${prFilter}`
      const res = await fetch(`http://localhost:8000/api/github/prs/${projectId}${stateParam}`)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load pull requests')
      }

      const data = await res.json()
      setPrs(data.pull_requests || [])
    } catch (e: any) {
      console.error('Failed to load PRs:', e)
      setError(e.message || 'Failed to load pull requests. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    // Check if GitHub token is configured
    if (!hasGithubToken) {
      setShowTokenPrompt(true)
      return
    }

    setImporting(true)
    setError(null)
    setImportSuccess(false)
    try {
      // Import both issues and PRs
      const [issuesRes, prsRes] = await Promise.all([
        fetch(`http://localhost:8000/api/github/import-issues/${projectId}`, {
          method: 'POST'
        }),
        fetch(`http://localhost:8000/api/github/import-prs/${projectId}`, {
          method: 'POST'
        })
      ])

      if (!issuesRes.ok) {
        const data = await issuesRes.json()
        throw new Error(data.detail || 'Failed to import issues from GitHub')
      }

      if (!prsRes.ok) {
        const data = await prsRes.json()
        throw new Error(data.detail || 'Failed to import pull requests from GitHub')
      }

      setImportSuccess(true)

      // Refresh the current view
      if (activeTab === 'issues') {
        await loadIssues()
      } else {
        await loadPRs()
      }

      onImport()

      // Hide success message after 3 seconds
      setTimeout(() => setImportSuccess(false), 3000)
    } catch (e: any) {
      console.error('Failed to import:', e)
      setError(e.message || 'Failed to import from GitHub. Please check your settings and try again.')
    } finally {
      setImporting(false)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    if (days < 365) return `${Math.floor(days / 30)} months ago`
    return `${Math.floor(days / 365)} years ago`
  }

  function getStateColor(state: string, merged: boolean = false) {
    if (merged) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    if (state === 'open') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }

  function getStateIcon(state: string, merged: boolean = false) {
    if (merged) return '✓'
    if (state === 'open') return '○'
    return '✓'
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {repoName}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
              Browse issues and pull requests
            </p>
            {lastSyncedAt && (
              <p className="text-gray-500 dark:text-gray-500 mt-1 text-xs">
                Last synced: {formatDate(lastSyncedAt)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onReindex}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
              title="Re-index code to update embeddings when code changes"
            >
              Re-index Code
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Syncing...
                </>
              ) : (
                'Sync Issues/PRs'
              )}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-red-600 dark:text-red-400 text-lg">⚠</span>
              <div className="flex-1">
                <p className="text-red-800 dark:text-red-200 font-medium text-sm">Error</p>
                <p className="text-red-700 dark:text-red-300 text-sm mt-1">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Success Message */}
        {importSuccess && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-green-600 dark:text-green-400 text-lg">✓</span>
              <div className="flex-1">
                <p className="text-green-800 dark:text-green-200 font-medium text-sm">Success</p>
                <p className="text-green-700 dark:text-green-300 text-sm mt-1">
                  Successfully synced issues and pull requests from GitHub
                </p>
              </div>
            </div>
          </div>
        )}

        {/* GitHub Token Required Prompt */}
        {showTokenPrompt && (
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-blue-600 dark:text-blue-400 text-lg">ℹ</span>
              <div className="flex-1">
                <p className="text-blue-800 dark:text-blue-200 font-medium text-sm">GitHub Token Required</p>
                <p className="text-blue-700 dark:text-blue-300 text-sm mt-1">
                  To sync issues and pull requests from GitHub, you need to add a GitHub Fine-Grained Personal Access Token
                  with "Issues" and "Pull requests" read-only permissions.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setShowTokenPrompt(false)
                      onOpenSettings()
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                  >
                    Add GitHub Token
                  </button>
                  <button
                    onClick={() => setShowTokenPrompt(false)}
                    className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('issues')}
            className={`pb-3 px-1 font-medium text-sm transition-colors ${
              activeTab === 'issues'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Issues ({issues.length})
          </button>
          <button
            onClick={() => setActiveTab('prs')}
            className={`pb-3 px-1 font-medium text-sm transition-colors ${
              activeTab === 'prs'
                ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Pull Requests ({prs.length})
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-4">
          {activeTab === 'issues' ? (
            <>
              <button
                onClick={() => setIssueFilter('all')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  issueFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setIssueFilter('open')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  issueFilter === 'open'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setIssueFilter('closed')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  issueFilter === 'closed'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Closed
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPrFilter('all')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  prFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setPrFilter('open')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  prFilter === 'open'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setPrFilter('closed')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  prFilter === 'closed'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Closed
              </button>
              <button
                onClick={() => setPrFilter('merged')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  prFilter === 'merged'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Merged
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeTab === 'issues' ? (
          issues.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
              <p className="text-lg font-semibold mb-2">No issues found</p>
              <p className="text-sm">Click "Sync from GitHub" to import issues</p>
            </div>
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => (
                <a
                  key={issue.number}
                  href={issue.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStateColor(issue.state)} mt-1`}>
                      {getStateIcon(issue.state)} {issue.state}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                        #{issue.number} {issue.title}
                      </h3>
                      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                        <span>by {issue.author}</span>
                        <span>{formatDate(issue.created_at)}</span>
                      </div>
                      {issue.labels.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {issue.labels.map((label, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )
        ) : (
          prs.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
              <p className="text-lg font-semibold mb-2">No pull requests found</p>
              <p className="text-sm">Click "Sync from GitHub" to import pull requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {prs.map((pr) => (
                <a
                  key={pr.number}
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStateColor(pr.state, !!pr.merged_at)} mt-1`}>
                      {getStateIcon(pr.state, !!pr.merged_at)} {pr.merged_at ? 'merged' : pr.state}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                        #{pr.number} {pr.title}
                      </h3>
                      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                        <span>by {pr.author}</span>
                        <span>{formatDate(pr.created_at)}</span>
                        {pr.merged_at && <span>merged {formatDate(pr.merged_at)}</span>}
                      </div>
                      {pr.labels.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {pr.labels.map((label, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

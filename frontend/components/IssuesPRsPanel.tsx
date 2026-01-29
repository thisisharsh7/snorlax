'use client'

import { useState, useEffect, useRef } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

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
  isBackgroundSyncing?: boolean
}

export default function IssuesPRsPanel({ projectId, repoName, lastSyncedAt, onImport, onOpenSettings, onReindex, isBackgroundSyncing }: IssuesPRsPanelProps) {
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

  // Ref for immediate race condition checking
  const importingRef = useRef(false)

  // Reset UI state when switching repositories
  useEffect(() => {
    setError(null)
    setImportSuccess(false)
    setShowTokenPrompt(false)
    setImporting(false)
    // Note: loading, issues, prs, activeTab, filters are handled by the data loading effect
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      await checkGithubToken()
      if (activeTab === 'issues') {
        await loadIssues()
      } else {
        await loadPRs()
      }
    }

    loadData()

    return () => {
      controller.abort() // Cancel any pending requests on unmount
    }
  }, [projectId, activeTab, issueFilter, prFilter])

  async function checkGithubToken() {
    try {
      const res = await fetch(API_ENDPOINTS.settings())
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
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const stateParam = issueFilter === 'all' ? '' : `?state=${issueFilter}`
      const res = await fetch(`${API_ENDPOINTS.githubIssues(projectId)}${stateParam}`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load issues')
      }

      const data = await res.json()
      setIssues(data.issues || [])
    } catch (e: any) {
      if (e.name === 'AbortError') return // Ignore aborted requests
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
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const stateParam = prFilter === 'all' ? '' : `?state=${prFilter}`
      const res = await fetch(`${API_ENDPOINTS.githubPRs(projectId)}${stateParam}`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load pull requests')
      }

      const data = await res.json()
      setPrs(data.pull_requests || [])
    } catch (e: any) {
      if (e.name === 'AbortError') return // Ignore aborted requests
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

    // Prevent multiple simultaneous import operations from rapid clicks
    if (importingRef.current) {
      return
    }

    importingRef.current = true
    setImporting(true)
    setError(null)
    setImportSuccess(false)
    try {
      // Import both issues and PRs
      const [issuesRes, prsRes] = await Promise.all([
        fetch(API_ENDPOINTS.importIssues(projectId), {
          method: 'POST'
        }),
        fetch(API_ENDPOINTS.importPRs(projectId), {
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

      // Get detailed import statistics
      const issuesData = await issuesRes.json()
      const prsData = await prsRes.json()

      // Check if we hit the limit (might have more data to import)
      const issuesLimitReached = issuesData.imported >= 500
      const prsLimitReached = prsData.imported >= 500

      if (issuesLimitReached || prsLimitReached) {
        setImportSuccess(true)
        setError(`Successfully imported ${issuesData.imported} issues and ${prsData.imported} PRs. There may be more data available - click "Sync from GitHub" again to continue importing.`)
      } else {
        setImportSuccess(true)
        console.log(`Import complete: ${issuesData.imported} new issues, ${prsData.imported} new PRs`)
      }

      // Refresh the current view
      if (activeTab === 'issues') {
        await loadIssues()
      } else {
        await loadPRs()
      }

      onImport()

      // Hide success message after 5 seconds (longer for large imports)
      setTimeout(() => {
        setImportSuccess(false)
        setError(null)
      }, 5000)
    } catch (e: any) {
      console.error('Failed to import:', e)
      setError(e.message || 'Failed to import from GitHub. Please check your settings and try again.')
    } finally {
      importingRef.current = false
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
    <div className="flex-1 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Sub-tabs for Issues/PRs - Only show if repository has been synced */}
      {lastSyncedAt && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('issues')}
              className={`pb-2 px-1 font-medium text-sm transition-colors ${
                activeTab === 'issues'
                  ? 'border-b-2 border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Issues ({issues.length})
            </button>
            <button
              onClick={() => setActiveTab('prs')}
              className={`pb-2 px-1 font-medium text-sm transition-colors ${
                activeTab === 'prs'
                  ? 'border-b-2 border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Pull Requests ({prs.length})
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mt-3">
          {activeTab === 'issues' ? (
            <>
              <button
                onClick={() => setIssueFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  issueFilter === 'all'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setIssueFilter('open')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  issueFilter === 'open'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setIssueFilter('closed')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  issueFilter === 'closed'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
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
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  prFilter === 'all'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setPrFilter('open')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  prFilter === 'open'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setPrFilter('closed')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  prFilter === 'closed'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Closed
              </button>
              <button
                onClick={() => setPrFilter('merged')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  prFilter === 'merged'
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Merged
              </button>
            </>
          )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeTab === 'issues' ? (
          issues.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {isBackgroundSyncing ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-lg font-semibold mb-2">Syncing issues...</p>
                    <p className="text-sm">Please wait while we import issues from GitHub</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold mb-2">No issues found</p>
                    <p className="text-sm">Click "Sync Issues/PRs" to import issues</p>
                  </>
                )}
              </div>
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
                          {issue.labels.map((label) => (
                            <span key={`issue-${issue.number}-label-${label}`} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
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
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {isBackgroundSyncing ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-lg font-semibold mb-2">Syncing pull requests...</p>
                    <p className="text-sm">Please wait while we import pull requests from GitHub</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold mb-2">No pull requests found</p>
                    <p className="text-sm">Click "Sync Issues/PRs" to import pull requests</p>
                  </>
                )}
              </div>
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
                          {pr.labels.map((label) => (
                            <span key={`pr-${pr.number}-label-${label}`} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
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

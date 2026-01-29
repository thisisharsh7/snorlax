'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import RepoSidebar from '@/components/RepoSidebar'
import IssuesPRsPanel from '@/components/IssuesPRsPanel'
import CategorizedIssuesPanel from '@/components/CategorizedIssuesPanel'
import TriageDashboard from '@/components/TriageDashboard'
import TriageModeModal from '@/components/TriageModeModal'
import IndexModal from '@/components/IndexModal'
import SettingsModal from '@/components/SettingsModal'
import { Github, Settings, Sun, Moon, RefreshCw, AlertTriangle } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/config'

interface Repository {
  repo_url: string
  project_id: string
  repo_name: string
  indexed_at: string
  status: string
  last_synced_at: string | null
  error_message?: string
  last_error_at?: string
}

export default function Dashboard() {
  const searchParams = useSearchParams()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [showIndexModal, setShowIndexModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showTriageModal, setShowTriageModal] = useState(false)
  const [repos, setRepos] = useState<Repository[]>([])
  const [issuesView, setIssuesView] = useState<'basic' | 'categorized' | 'triage'>('triage')
  const [hasAIKey, setHasAIKey] = useState(false)
  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [showBanner, setShowBanner] = useState(true)
  const [isDark, setIsDark] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncAbortController, setSyncAbortController] = useState<AbortController | null>(null)
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{imported: number, total: number} | null>(null)
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    resetTime: string | null,
    message: string
  } | null>(null)

  // Ref for immediate race condition checking
  const syncingRef = useRef(false)

  // Initialize dark mode
  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark')
    setIsDark(isDarkMode)
  }, [])

  function toggleDarkMode() {
    const newDarkMode = !isDark
    setIsDark(newDarkMode)
    if (newDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', newDarkMode ? 'true' : 'false')
  }

  // Load initial repository from URL parameter
  useEffect(() => {
    const projectId = searchParams.get('project')
    if (projectId) {
      setSelectedProjectId(projectId)
    }
  }, [searchParams])

  // Load repositories to get selected repo details
  useEffect(() => {
    loadRepositories()
    checkSettings()
  }, [])

  // Poll for repository updates when a repository is indexing
  useEffect(() => {
    // Only poll if we have a selected repo that's indexing
    if (!selectedRepo || selectedRepo.status !== 'indexing') {
      return
    }

    // Poll every 5 seconds
    const interval = setInterval(() => {
      loadRepositories()
    }, 5000)

    return () => clearInterval(interval)
  }, [selectedRepo?.status, selectedRepo?.project_id])

  // Check sync status when project changes (initial check)
  useEffect(() => {
    if (!selectedProjectId) return
    checkSyncStatus()
  }, [selectedProjectId])

  // Poll for background sync status when actively syncing (but not rate limited)
  useEffect(() => {
    if (!isBackgroundSyncing || rateLimitInfo) return

    const interval = setInterval(checkSyncStatus, 3000)
    return () => clearInterval(interval)
  }, [isBackgroundSyncing, rateLimitInfo])

  // Update countdown timer every second when rate limited
  useEffect(() => {
    if (!rateLimitInfo || !rateLimitInfo.resetTime) return

    const interval = setInterval(() => {
      // Force re-render to update the countdown
      setRateLimitInfo(prev => prev ? { ...prev } : null)
    }, 1000)

    return () => clearInterval(interval)
  }, [rateLimitInfo])

  async function checkSyncStatus() {
    if (!selectedProjectId) return

    try {
      const res = await fetch(API_ENDPOINTS.syncStatus(selectedProjectId))
      const data = await res.json()

      console.log('[Sync Status] Response:', data)

      if (data.status === 'no_jobs') {
        // No background jobs
        console.log('[Sync Status] No jobs - stopping indicator')
        setIsBackgroundSyncing(false)
        setSyncProgress(null)
        setRateLimitInfo(null)
      } else if (data.status === 'in_progress' || data.status === 'queued') {
        // Check if rate limited
        if (data.rate_limited) {
          // Rate limited - stop polling and show banner
          console.log('[Sync Status] Rate limited - stopping indicator')
          setIsBackgroundSyncing(false)
          setRateLimitInfo({
            resetTime: data.rate_limit_reset_time || null,
            message: data.message || 'GitHub rate limit exceeded. Add a GitHub token in Settings for higher limits.'
          })
          // Keep sync progress to show what was imported
          setSyncProgress({
            imported: data.imported_count || 0,
            total: data.total_count || 0
          })
        } else {
          // Background job running normally
          console.log('[Sync Status] In progress - showing indicator')
          setIsBackgroundSyncing(true)
          setSyncProgress({
            imported: data.imported_count || 0,
            total: data.total_count || 0
          })
        }
      } else if (data.status === 'completed') {
        // Job just completed
        console.log('[Sync Status] Completed - stopping indicator')
        setIsBackgroundSyncing(false)
        setSyncProgress(null)
        setRateLimitInfo(null)
        // Reload repositories to show updated counts
        await loadRepositories()
      } else if (data.status === 'failed') {
        // Job failed
        console.log('[Sync Status] Failed - stopping indicator')
        setIsBackgroundSyncing(false)
        setSyncProgress(null)
        setRateLimitInfo(null)
        console.error('Background sync failed:', data.error_message)
      } else {
        // Unknown status - stop syncing indicator to be safe
        console.warn('[Sync Status] Unknown status:', data.status, '- stopping indicator')
        setIsBackgroundSyncing(false)
        setSyncProgress(null)
      }
    } catch (e) {
      console.error('[Sync Status] Failed to check sync status:', e)
      // Stop syncing indicator on error
      setIsBackgroundSyncing(false)
    }
  }

  async function checkSettings() {
    try {
      const res = await fetch(API_ENDPOINTS.settings())
      const data = await res.json()
      setHasAIKey(data.anthropic_key_set || data.openai_key_set || data.openrouter_key_set)
      setHasGithubToken(data.github_token_set)
    } catch (e) {
      console.error('Failed to check settings:', e)
    }
  }

  function formatTimeRemaining(resetTimeStr: string | null): string {
    if (!resetTimeStr) return 'soon'

    try {
      const resetTime = new Date(resetTimeStr).getTime()
      const now = Date.now()
      const diffMs = resetTime - now

      if (diffMs <= 0) return 'now'

      const minutes = Math.floor(diffMs / 60000)
      const seconds = Math.floor((diffMs % 60000) / 1000)

      if (minutes > 0) {
        return `${minutes}m ${seconds}s`
      } else {
        return `${seconds}s`
      }
    } catch (e) {
      return 'soon'
    }
  }

  // Update selected repo when selectedProjectId changes
  useEffect(() => {
    if (selectedProjectId && repos.length > 0) {
      const repo = repos.find(r => r.project_id === selectedProjectId)
      if (repo) {
        setSelectedRepo(repo)
      }
    }
  }, [selectedProjectId, repos])

  async function loadRepositories() {
    try {
      const res = await fetch(API_ENDPOINTS.repositories())
      const data = await res.json()
      setRepos(data)

      // Auto-select first indexed repo if none selected
      if (!selectedProjectId && data.length > 0) {
        const firstIndexed = data.find((r: Repository) => r.status === 'indexed')
        if (firstIndexed) {
          setSelectedProjectId(firstIndexed.project_id)
        }
      }
    } catch (e) {
      console.error('Failed to load repositories:', e)
    }
  }

  async function handleIndexComplete(projectId: string) {
    console.log('📍 [DEBUG] Index complete callback received:', projectId)
    // Refresh repositories list and wait for it to complete
    console.log('🔄 [DEBUG] Loading repositories...')
    await loadRepositories()
    console.log('✅ [DEBUG] Repositories loaded, selecting project')
    // Select the newly indexed project
    setSelectedProjectId(projectId)
    console.log('✅ [DEBUG] Project selected:', projectId)
  }

  async function handleReindex() {
    if (!selectedRepo) {
      console.error('[Re-index] No repository selected')
      return
    }

    console.log('[Re-index] Starting re-index for:', selectedRepo.project_id)

    try {
      const endpoint = API_ENDPOINTS.reindex(selectedRepo.project_id)
      console.log('[Re-index] Calling endpoint:', endpoint)

      const res = await fetch(endpoint, {
        method: 'POST'
      })

      console.log('[Re-index] Response status:', res.status)

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: 'Unknown error' }))
        console.error('[Re-index] Error response:', errorData)
        throw new Error(errorData.detail || 'Failed to start re-indexing')
      }

      const result = await res.json()
      console.log('[Re-index] Success:', result)

      // Refresh repository list to show updated status
      await loadRepositories()
    } catch (e) {
      console.error('[Re-index] Failed to start re-indexing:', e)
      alert(`Failed to start re-indexing: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleSync() {
    if (!selectedRepo || !hasGithubToken) {
      setShowSettingsModal(true)
      return
    }

    // If already syncing, this is a cancel/stop request
    if (syncAbortController) {
      syncAbortController.abort()
      setSyncAbortController(null)
      syncingRef.current = false
      setSyncing(false)
      alert('Sync cancelled')
      return
    }

    // Prevent multiple simultaneous sync operations from rapid clicks
    if (syncingRef.current) {
      return
    }

    // Create new abort controller for this sync operation
    syncingRef.current = true
    const controller = new AbortController()
    setSyncAbortController(controller)
    setSyncing(true)

    try {
      const [issuesRes, prsRes] = await Promise.all([
        fetch(API_ENDPOINTS.importIssues(selectedRepo.project_id), {
          method: 'POST',
          signal: controller.signal
        }),
        fetch(API_ENDPOINTS.importPRs(selectedRepo.project_id), {
          method: 'POST',
          signal: controller.signal
        })
      ])

      // Check responses
      if (!issuesRes.ok) {
        const errorData = await issuesRes.json().catch(() => ({detail: issuesRes.statusText}))

        if (issuesRes.status === 429) {
          const resetTime = errorData.detail?.reset_time
            ? new Date(errorData.detail.reset_time * 1000).toLocaleTimeString()
            : 'later'
          alert(`⏱️ GitHub rate limit exceeded. Please try again at ${resetTime}.\n\n💡 Tip: Add a GitHub token in Settings for higher limits (5000/hour vs 60/hour)`)
        } else {
          alert(`❌ Issues sync failed: ${errorData.detail?.message || errorData.detail || issuesRes.statusText}`)
        }
        throw new Error('Sync failed')
      }

      if (!prsRes.ok) {
        const errorData = await prsRes.json().catch(() => ({detail: prsRes.statusText}))

        if (prsRes.status === 429) {
          const resetTime = errorData.detail?.reset_time
            ? new Date(errorData.detail.reset_time * 1000).toLocaleTimeString()
            : 'later'
          alert(`⏱️ GitHub rate limit exceeded. Please try again at ${resetTime}.\n\n💡 Tip: Add a GitHub token in Settings for higher limits (5000/hour vs 60/hour)`)
        } else {
          alert(`❌ PRs sync failed: ${errorData.detail?.message || errorData.detail || prsRes.statusText}`)
        }
        throw new Error('Sync failed')
      }

      // Parse success responses
      const issuesData = await issuesRes.json()
      const prsData = await prsRes.json()

      // Show detailed results
      alert(`✅ Synced ${issuesData.imported} issues and ${prsData.imported} PRs`)

      await loadRepositories()
    } catch (e) {
      // Handle abort (user cancelled)
      if (e instanceof Error && e.name === 'AbortError') {
        console.log('Sync cancelled by user')
        return
      }
      console.error('Failed to sync:', e)
      alert(`❌ Sync failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      syncingRef.current = false
      setSyncAbortController(null)
      setSyncing(false)
    }
  }

  return (
    <div className="h-screen flex">
      <RepoSidebar
        selectedProjectId={selectedProjectId}
        onSelectRepo={setSelectedProjectId}
        onNewRepo={() => setShowIndexModal(true)}
        onSettingsClick={() => setShowSettingsModal(true)}
        isDark={isDark}
        onToggleDarkMode={toggleDarkMode}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Configuration Warning Banner */}
        {showBanner && (!hasAIKey || !hasGithubToken) && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-yellow-600 dark:text-yellow-400 text-base">⚠</span>
              <div className="flex-1">
                <span className="text-yellow-800 dark:text-yellow-200 font-medium text-xs">
                  Configuration Recommended:{' '}
                </span>
                <span className="text-yellow-700 dark:text-yellow-300 text-xs">
                  {!hasGithubToken && !hasAIKey && (
                    <>Add GitHub token to sync issues/PRs and AI provider key to use Snorlax. </>
                  )}
                  {!hasGithubToken && hasAIKey && (
                    <>Add GitHub token to sync issues and pull requests from GitHub. </>
                  )}
                  {hasGithubToken && !hasAIKey && (
                    <>Add AI provider key to use the Snorlax feature. </>
                  )}
                  <button
                    onClick={() => setShowSettingsModal(true)}
                    className="text-yellow-900 dark:text-yellow-100 underline font-medium hover:no-underline"
                  >
                    Configure now
                  </button>
                </span>
              </div>
              <button
                onClick={() => setShowBanner(false)}
                className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 text-sm"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {selectedRepo ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Unified Header */}
          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
            <div className="flex justify-between items-center">
              {/* Tab Buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRepo.status === 'indexed') {
                      setIssuesView('basic')
                    }
                  }}
                  disabled={selectedRepo.status !== 'indexed'}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    issuesView === 'basic'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : selectedRepo.status === 'indexed'
                      ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      : 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                  }`}
                  title={selectedRepo.status !== 'indexed' ? 'Repository must be indexed first' : ''}
                >
                  Issues & PRs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRepo.status === 'indexed') {
                      setIssuesView('categorized')
                    }
                  }}
                  disabled={selectedRepo.status !== 'indexed'}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    issuesView === 'categorized'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : selectedRepo.status === 'indexed'
                      ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      : 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                  }`}
                  title={selectedRepo.status !== 'indexed' ? 'Repository must be indexed first' : ''}
                >
                  AI Analysis
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRepo.status === 'indexed') {
                      setIssuesView('triage')
                    }
                  }}
                  disabled={selectedRepo.status !== 'indexed'}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    issuesView === 'triage'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : selectedRepo.status === 'indexed'
                      ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      : 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                  }`}
                  title={selectedRepo.status !== 'indexed' ? 'Repository must be indexed first' : ''}
                >
                  Triage Dashboard
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReindex}
                  disabled={selectedRepo.status === 'indexing'}
                  className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  title={selectedRepo.status === 'indexing' ? 'Repository is currently indexing' : 'Re-index code to update embeddings'}
                >
                  <RefreshCw className={`w-4 h-4 ${selectedRepo.status === 'indexing' ? 'animate-spin' : ''}`} />
                  {selectedRepo.status === 'indexing' ? 'Indexing...' : 'Re-index Code'}
                </button>

                {/* Background Sync Indicator */}
                {isBackgroundSyncing && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 dark:border-blue-400 border-t-transparent"></div>
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                      {syncProgress && syncProgress.total > 0
                        ? `Syncing... ${syncProgress.imported}/${syncProgress.total}`
                        : 'Syncing...'
                      }
                    </span>
                  </div>
                )}

                {/* Rate Limit Banner */}
                {rateLimitInfo && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300 leading-tight">
                        Rate limit exceeded
                      </p>
                      {rateLimitInfo.resetTime && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 leading-tight">
                          Resets in: {formatTimeRemaining(rateLimitInfo.resetTime)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setShowSettingsModal(true)}
                      className="px-2 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors flex-shrink-0"
                    >
                      Add Token
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          {selectedRepo.status === 'indexed' ? (
            issuesView === 'basic' ? (
              <IssuesPRsPanel
                projectId={selectedRepo.project_id}
                repoName={selectedRepo.repo_name}
                lastSyncedAt={selectedRepo.last_synced_at}
                onImport={loadRepositories}
                onOpenSettings={() => setShowSettingsModal(true)}
                onReindex={handleReindex}
                isBackgroundSyncing={isBackgroundSyncing}
              />
            ) : issuesView === 'categorized' ? (
              <CategorizedIssuesPanel
                projectId={selectedRepo.project_id}
                repoName={selectedRepo.repo_name}
              />
            ) : (
              <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
                <TriageDashboard
                  projectId={selectedRepo.project_id}
                  onEnterTriageMode={() => setShowTriageModal(true)}
                />
              </div>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center max-w-2xl px-4">
                {selectedRepo.status === 'indexing' && (
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 dark:border-gray-700 border-t-gray-900 dark:border-t-gray-300 mx-auto mb-4"></div>
                )}
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {selectedRepo.status === 'indexing' ? 'Indexing Repository' : 'Repository Not Ready'}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {selectedRepo.status === 'indexing'
                    ? 'Please wait while we index your repository. This may take a few minutes.'
                    : 'This repository failed to index. Please try re-indexing.'}
                </p>

                {/* Error Details */}
                {selectedRepo.status === 'failed' && selectedRepo.error_message && (
                  <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 text-left">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
                      Error Details:
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300 font-mono break-words">
                      {selectedRepo.error_message}
                    </p>
                    {selectedRepo.last_error_at && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-3">
                        Last error at: {new Date(selectedRepo.last_error_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <p className="text-6xl mb-4">Select a repository</p>
            <p className="text-xl font-semibold mb-2">Choose a repository</p>
            <p className="text-sm">Select a repository from the sidebar to get started</p>
          </div>
        </div>
        )}
      </div>

      <IndexModal
        isOpen={showIndexModal}
        onClose={() => setShowIndexModal(false)}
        onIndexComplete={handleIndexComplete}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false)
          checkSettings() // Refresh settings status when modal closes
        }}
      />

      {selectedRepo && (
        <TriageModeModal
          projectId={selectedRepo.project_id}
          isOpen={showTriageModal}
          onClose={() => setShowTriageModal(false)}
        />
      )}
    </div>
  )
}

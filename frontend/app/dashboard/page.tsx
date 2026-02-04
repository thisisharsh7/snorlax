'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import RepoSidebar from '@/components/RepoSidebar'
import IssuesPRsPanel from '@/components/IssuesPRsPanel'
import CategorizedIssuesPanel from '@/components/CategorizedIssuesPanel'
import TriageModeModal from '@/components/TriageModeModal'
import IndexModal from '@/components/IndexModal'
import IndexingTimeline from '@/components/IndexingTimeline'
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
  const [selectedIssueForTriage, setSelectedIssueForTriage] = useState<number | null>(null)
  const [repos, setRepos] = useState<Repository[]>([])
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
  const [activelyIndexingProjects, setActivelyIndexingProjects] = useState<Set<string>>(new Set())
  const [indexingStartTimes, setIndexingStartTimes] = useState<Map<string, number>>(new Map())

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

      // Return the data for callers that need it
      return data
    } catch (e) {
      console.error('Failed to load repositories:', e)
      return []
    }
  }

  // Clean up stale entries from activelyIndexingProjects
  useEffect(() => {
    if (repos.length > 0 && activelyIndexingProjects.size > 0) {
      const staleLookup = new Set<string>()

      repos.forEach(repo => {
        // If repo is in the actively indexing set but backend says it's indexed
        // (and has been for >5 minutes), remove it
        if (activelyIndexingProjects.has(repo.project_id) && repo.status === 'indexed') {
          if (repo.indexed_at) {
            const indexedTime = new Date(repo.indexed_at).getTime()
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)

            // If it's been indexed for more than 5 minutes, it's stale
            if (indexedTime < fiveMinutesAgo) {
              staleLookup.add(repo.project_id)
            }
          }
        }
      })

      // Remove stale entries
      if (staleLookup.size > 0) {
        console.log('🧹 Cleaning up stale indexing entries:', Array.from(staleLookup))
        setActivelyIndexingProjects(prev => {
          const newSet = new Set(prev)
          staleLookup.forEach(id => newSet.delete(id))
          return newSet
        })
        setIndexingStartTimes(prev => {
          const newMap = new Map(prev)
          staleLookup.forEach(id => newMap.delete(id))
          return newMap
        })
      }
    }
  }, [repos, activelyIndexingProjects.size])

  async function handleIndexComplete(projectId: string) {
    console.log('📍 [DEBUG] Index complete callback received:', projectId)

    // Record the actual start time for this project
    setIndexingStartTimes(prev => new Map(prev).set(projectId, Date.now()))

    // Mark this project as actively indexing (includes import phase)
    setActivelyIndexingProjects(prev => new Set(prev).add(projectId))

    // Refresh repositories list with retry logic to ensure repo is loaded
    console.log('🔄 [DEBUG] Loading repositories...')
    let retries = 0
    const maxRetries = 3
    let loadedRepos: Repository[] = []

    while (retries < maxRetries) {
      loadedRepos = await loadRepositories()

      // Check if the repo is now in the list
      const repoExists = loadedRepos.some(r => r.project_id === projectId)
      if (repoExists) {
        console.log('✅ [DEBUG] Repository found in list')
        break
      }

      // If not found, wait a bit and retry
      retries++
      if (retries < maxRetries) {
        console.log(`⏳ [DEBUG] Repository not found, retrying... (${retries}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    console.log('✅ [DEBUG] Repositories loaded, selecting project')

    // Select the newly indexed project
    setSelectedProjectId(projectId)
    console.log('✅ [DEBUG] Project selected:', projectId)
  }

  function handleIndexingComplete(projectId: string) {
    console.log('✅ [DEBUG] Full indexing flow complete for:', projectId)

    // Remove from actively indexing set
    setActivelyIndexingProjects(prev => {
      const newSet = new Set(prev)
      newSet.delete(projectId)
      return newSet
    })

    // Remove the start time tracking
    setIndexingStartTimes(prev => {
      const newMap = new Map(prev)
      newMap.delete(projectId)
      return newMap
    })

    // Refresh repositories to get the final status
    loadRepositories()
  }

  async function handleReindex(projectId?: string) {
    const targetProjectId = projectId || selectedRepo?.project_id

    if (!targetProjectId) {
      console.error('[Re-index] No repository selected')
      return
    }

    console.log('[Re-index] Starting re-index for:', targetProjectId)

    try {
      const endpoint = API_ENDPOINTS.reindex(targetProjectId)
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

      // Set up tracking state (same as handleIndexComplete)
      console.log('[Re-index] Setting up tracking state')
      setIndexingStartTimes(prev => new Map(prev).set(targetProjectId, Date.now()))
      setActivelyIndexingProjects(prev => new Set(prev).add(targetProjectId))

      // Refresh repository list to show updated status
      await loadRepositories()

      // Select the reindexing project to show timeline
      setSelectedProjectId(targetProjectId)
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
      // UPDATED: Only import issues, PR functionality removed for first version
      const issuesRes = await fetch(API_ENDPOINTS.importIssues(selectedRepo.project_id), {
        method: 'POST',
        signal: controller.signal
      })

      // Check response
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

      // Parse success response
      const issuesData = await issuesRes.json()

      // Show detailed results
      alert(`✅ Synced ${issuesData.imported} issues`)

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
        onReindex={handleReindex}
        isBackgroundSyncing={isBackgroundSyncing}
        syncProgress={syncProgress}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Configuration Warning Banner */}
        {showBanner && (!hasAIKey || !hasGithubToken) && (
          <div className="bg-accent-amber-50 dark:bg-accent-amber-900/20 border-b border-accent-amber-200 dark:border-accent-amber-800 px-4 py-2">
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
          {/* Rate Limit Banner - Background sync moved to sidebar */}
          {rateLimitInfo && (
            <div className="bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
              <div className="flex justify-end items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-amber-50 dark:bg-accent-amber-900/20 border border-accent-amber-200 dark:border-accent-amber-800 rounded-lg">
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
                {activelyIndexingProjects.size > 0 && (
                  <button
                    onClick={() => {
                      console.log('🧹 Manually clearing all indexing state')
                      setActivelyIndexingProjects(new Set())
                      setIndexingStartTimes(new Map())
                    }}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    title="Clear indexing state (debug)"
                  >
                    🧹
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Content */}
          {(() => {
            // Priority 1: If backend says indexed AND (not in active set OR indexed >5min ago), show issues
            const isRecentlyIndexed = selectedRepo.indexed_at &&
              (Date.now() - new Date(selectedRepo.indexed_at).getTime()) < (5 * 60 * 1000)

            if (selectedRepo.status === 'indexed' &&
                (!activelyIndexingProjects.has(selectedRepo.project_id) || !isRecentlyIndexed)) {
              return (
                <IssuesPRsPanel
                  projectId={selectedRepo.project_id}
                  repoName={selectedRepo.repo_name}
                  lastSyncedAt={selectedRepo.last_synced_at}
                  onImport={loadRepositories}
                  onOpenSettings={() => setShowSettingsModal(true)}
                  onReindex={handleReindex}
                  isBackgroundSyncing={isBackgroundSyncing}
                  onOpenTriage={(issueNumber) => {
                    setSelectedIssueForTriage(issueNumber)
                    setShowTriageModal(true)
                  }}
                />
              )
            }

            // Priority 2: If indexing OR in active set with recent indexed_at, show timeline
            if (selectedRepo.status === 'indexing' ||
                (activelyIndexingProjects.has(selectedRepo.project_id) && isRecentlyIndexed)) {
              return (
                <IndexingTimeline
                  projectId={selectedRepo.project_id}
                  repoName={selectedRepo.repo_name}
                  startTime={indexingStartTimes.get(selectedRepo.project_id)}
                  onComplete={() => {
                    console.log('Indexing complete, refreshing repositories')
                    handleIndexingComplete(selectedRepo.project_id)
                  }}
                  onError={(error) => {
                    console.error('Indexing error:', error)
                    handleIndexingComplete(selectedRepo.project_id)
                  }}
                />
              )
            }

            // Priority 3: Failed state
            return (
              <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-900">
                <div className="text-center max-w-2xl px-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Repository Not Ready
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    This repository failed to index. Please try re-indexing.
                  </p>

                  {/* Error Details */}
                  {selectedRepo.error_message && (
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

                  {/* Reindex Button for Failed Status */}
                  <button
                    onClick={() => handleReindex(selectedRepo.project_id)}
                    className="mt-4 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 mx-auto"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Re-indexing
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      ) : (
        <div className="flex-1 bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center">
          <div className="text-center text-neutral-400 dark:text-neutral-500">
            <p className="text-4xl mb-4">Select a repository</p>
            <p className="text-lg font-medium mb-2">Choose a repository</p>
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
        <>
          <TriageModeModal
            projectId={selectedRepo.project_id}
            isOpen={showTriageModal}
            onClose={() => {
              setShowTriageModal(false)
              setSelectedIssueForTriage(null)
            }}
            initialIssueNumber={selectedIssueForTriage}
          />
        </>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import RepoSidebar from '@/components/RepoSidebar'
import IssuesPRsPanel from '@/components/IssuesPRsPanel'
import ChatPanel from '@/components/ChatPanel'
import IndexModal from '@/components/IndexModal'
import SettingsModal from '@/components/SettingsModal'
import { Github, Settings, Sun, Moon, RefreshCw } from 'lucide-react'

interface Repository {
  repo_url: string
  project_id: string
  repo_name: string
  indexed_at: string
  status: string
  last_synced_at: string | null
}

export default function Dashboard() {
  const searchParams = useSearchParams()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [showIndexModal, setShowIndexModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [repos, setRepos] = useState<Repository[]>([])
  const [activeView, setActiveView] = useState<'chat' | 'issues'>('issues')
  const [hasAIKey, setHasAIKey] = useState(false)
  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [showBanner, setShowBanner] = useState(true)
  const [isDark, setIsDark] = useState(false)
  const [syncing, setSyncing] = useState(false)

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

  async function checkSettings() {
    try {
      const res = await fetch('http://localhost:8000/api/settings')
      const data = await res.json()
      setHasAIKey(data.anthropic_key_set || data.openai_key_set || data.openrouter_key_set)
      setHasGithubToken(data.github_token_set)
    } catch (e) {
      console.error('Failed to check settings:', e)
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
      const res = await fetch('http://localhost:8000/api/repositories')
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

  function handleIndexComplete(projectId: string) {
    // Refresh repositories list
    loadRepositories()
    // Select the newly indexed project
    setSelectedProjectId(projectId)
  }

  async function handleReindex() {
    if (!selectedRepo) return

    try {
      const res = await fetch(`http://localhost:8000/api/reindex/${selectedRepo.project_id}`, {
        method: 'POST'
      })

      if (!res.ok) {
        throw new Error('Failed to start re-indexing')
      }

      // Refresh repository list to show updated status
      await loadRepositories()
    } catch (e) {
      console.error('Failed to start re-indexing:', e)
    }
  }

  async function handleSync() {
    if (!selectedRepo || !hasGithubToken) {
      setShowSettingsModal(true)
      return
    }

    setSyncing(true)
    try {
      await Promise.all([
        fetch(`http://localhost:8000/api/github/import-issues/${selectedRepo.project_id}`, {
          method: 'POST'
        }),
        fetch(`http://localhost:8000/api/github/import-prs/${selectedRepo.project_id}`, {
          method: 'POST'
        })
      ])
      await loadRepositories()
    } catch (e) {
      console.error('Failed to sync:', e)
    } finally {
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
      />

      <div className="flex-1 flex flex-col">
        {/* Configuration Warning Banner */}
        {showBanner && (!hasAIKey || !hasGithubToken) && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 p-4">
            <div className="flex items-start gap-3">
              <span className="text-yellow-600 dark:text-yellow-400 text-xl">⚠</span>
              <div className="flex-1">
                <p className="text-yellow-800 dark:text-yellow-200 font-medium text-sm">
                  Configuration Recommended
                </p>
                <p className="text-yellow-700 dark:text-yellow-300 text-sm mt-1">
                  {!hasGithubToken && !hasAIKey && (
                    <>Add GitHub token to sync issues/PRs and AI provider key to use Snorlax.</>
                  )}
                  {!hasGithubToken && hasAIKey && (
                    <>Add GitHub token to sync issues and pull requests from GitHub.</>
                  )}
                  {hasGithubToken && !hasAIKey && (
                    <>Add AI provider key to use the Snorlax feature.</>
                  )}
                  {' '}
                  <button
                    onClick={() => setShowSettingsModal(true)}
                    className="text-yellow-900 dark:text-yellow-100 underline font-medium hover:no-underline"
                  >
                    Configure now
                  </button>
                </p>
              </div>
              <button
                onClick={() => setShowBanner(false)}
                className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {selectedRepo && selectedRepo.status === 'indexed' ? (
        <div className="flex-1 flex flex-col">
          {/* Unified Header */}
          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
            <div className="flex justify-between items-center">
              {/* Tab Buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveView('issues')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    activeView === 'issues'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  Issues & PRs
                </button>
                <button
                  type="button"
                  onClick={() => hasAIKey && setActiveView('chat')}
                  disabled={!hasAIKey}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    activeView === 'chat'
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                      : hasAIKey
                      ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      : 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                  }`}
                  title={!hasAIKey ? 'Configure AI provider in Settings to use this feature' : ''}
                >
                  Snorlax
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  title="Settings"
                >
                  <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  title="Toggle dark mode"
                >
                  {isDark ? (
                    <Sun className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  ) : (
                    <Moon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleReindex}
                  className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                  title="Re-index code to update embeddings"
                >
                  <RefreshCw className="w-4 h-4" />
                  Re-index Code
                </button>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Github className="w-4 h-4" />
                      Sync Issues/PRs
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          {activeView === 'issues' ? (
            <IssuesPRsPanel
              projectId={selectedRepo.project_id}
              repoName={selectedRepo.repo_name}
              lastSyncedAt={selectedRepo.last_synced_at}
              onImport={loadRepositories}
              onOpenSettings={() => setShowSettingsModal(true)}
              onReindex={handleReindex}
            />
          ) : (
            <ChatPanel
              projectId={selectedRepo.project_id}
              repoName={selectedRepo.repo_name}
            />
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
    </div>
  )
}

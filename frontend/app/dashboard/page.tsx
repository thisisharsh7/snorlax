'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import RepoSidebar from '@/components/RepoSidebar'
import IssuesPRsPanel from '@/components/IssuesPRsPanel'
import ChatPanel from '@/components/ChatPanel'
import IndexModal from '@/components/IndexModal'
import SettingsModal from '@/components/SettingsModal'

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
                    <>Add GitHub token to sync issues/PRs and AI provider key to use Code Q&A.</>
                  )}
                  {!hasGithubToken && hasAIKey && (
                    <>Add GitHub token to sync issues and pull requests from GitHub.</>
                  )}
                  {hasGithubToken && !hasAIKey && (
                    <>Add AI provider key to use the Code Q&A feature.</>
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
          {/* View Toggle */}
          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveView('issues')}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  activeView === 'issues'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Issues & PRs
              </button>
              <button
                onClick={() => hasAIKey && setActiveView('chat')}
                disabled={!hasAIKey}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  activeView === 'chat'
                    ? 'bg-blue-600 text-white'
                    : hasAIKey
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                }`}
                title={!hasAIKey ? 'Configure AI provider in Settings to use this feature' : ''}
              >
                Code Q&A {!hasAIKey && '(requires AI key)'}
              </button>
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

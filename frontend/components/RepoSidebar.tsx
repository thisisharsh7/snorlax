'use client'

import { useEffect, useState } from 'react'
import { Github, Trash2, Settings, Sun, Moon, RefreshCw, Plus } from 'lucide-react'
import DeleteRepoModal from './DeleteRepoModal'
import { API_ENDPOINTS } from '@/lib/config'

interface Repository {
  repo_url: string
  project_id: string
  repo_name: string
  indexed_at: string
  status: 'indexing' | 'indexed' | 'failed'
}

interface RepoSidebarProps {
  selectedProjectId: string | null
  onSelectRepo: (projectId: string) => void
  onNewRepo: () => void
  onSettingsClick: () => void
  isDark: boolean
  onToggleDarkMode: () => void
  onReindex: (projectId: string) => void
  isBackgroundSyncing: boolean
  syncProgress: {imported: number, total: number} | null
}

export default function RepoSidebar({ selectedProjectId, onSelectRepo, onNewRepo, onSettingsClick, isDark, onToggleDarkMode, onReindex, isBackgroundSyncing, syncProgress }: RepoSidebarProps) {
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [repoToDelete, setRepoToDelete] = useState<Repository | null>(null)

  useEffect(() => {
    loadRepositories()
    const interval = setInterval(loadRepositories, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadRepositories() {
    try {
      const res = await fetch(API_ENDPOINTS.repositories())
      if (!res.ok) {
        console.error('Failed to load repositories: HTTP', res.status)
        setLoading(false)
        return
      }
      const data = await res.json()
      // Ensure data is an array before setting it
      if (Array.isArray(data)) {
        setRepos(data)
      } else {
        console.error('Invalid response format:', data)
        setRepos([])
      }
      setLoading(false)
    } catch (e) {
      console.error('Failed to load repositories:', e)
      setLoading(false)
    }
  }

  async function handleDeleteRepo(projectId: string) {
    try {
      const res = await fetch(API_ENDPOINTS.deleteRepo(projectId), {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to delete repository')
      }

      // Refresh the page to sync all state and clear cached data
      // This ensures the main content panel is properly cleared
      window.location.reload()
    } catch (e) {
      console.error('Failed to delete repository:', e)
      throw e
    }
  }

  return (
    <div className="w-64 bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col h-screen">
      {/* Header with Add Repository Button */}
      <div className=" py-4 px-2 flex items-center justify-between flex-shrink-0">
        {/* Add Repository Button - Left Side */}
        <button
          type="button"
          onClick={onNewRepo}
          className="flex items-center gap-2 bg-neutral-800 dark:bg-neutral-700 text-white px-4 py-2 rounded-md font-medium text-base hover:bg-neutral-700 dark:hover:bg-neutral-600 transition-colors whitespace-nowrap"
          title="Add a new repository to index"
        >
          <Plus className="w-4 h-4" />
          <span>Add Repository</span>
        </button>

        {/* Icons - Right Side */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Dark Mode Button */}
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-850 rounded-lg transition-colors"
            title="Toggle dark mode"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
            ) : (
              <Moon className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
            )}
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={onSettingsClick}
            className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-850 rounded-lg transition-colors"
            title="Settings - Configure API Keys"
          >
            <Settings className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
          </button>
        </div>
      </div>

      {/* Repository List - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2">
        {loading ? (
          <div className="p-4 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-transparent mx-auto"></div>
          </div>
        ) : repos.length === 0 ? (
          <div className="p-6 text-center">
            <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">No repositories yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {repos.map((repo) => (
              <div
                key={repo.project_id}
                className="relative"
                onMouseEnter={() => setHoveredId(repo.project_id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <button
                  type="button"
                  onClick={() => onSelectRepo(repo.project_id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-all flex items-center gap-2.5 ${
                    selectedProjectId === repo.project_id
                      ? 'bg-neutral-150 dark:bg-neutral-850 text-neutral-900 dark:text-neutral-100'
                      : 'hover:bg-neutral-150/50 dark:hover:bg-neutral-850/50'
                  } cursor-pointer`}
                >
                  {/* Icon - Changes on hover for indexed/failed repos */}
                  {hoveredId === repo.project_id && (repo.status === 'indexed' || repo.status === 'failed') ? (
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        onReindex(repo.project_id)
                      }}
                      className="p-0.5 hover:bg-neutral-300 dark:hover:bg-neutral-700 rounded transition-colors flex-shrink-0 cursor-pointer"
                      title={repo.status === 'failed' ? 'Retry indexing' : 'Re-index code'}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          onReindex(repo.project_id)
                        }
                      }}
                    >
                      <RefreshCw className={`w-4 h-4 ${repo.status === 'failed' ? 'text-accent-red-500 dark:text-accent-red-400' : 'text-neutral-600 dark:text-neutral-400'}`} />
                    </div>
                  ) : (
                    <Github className="w-4 h-4 flex-shrink-0 text-neutral-600 dark:text-neutral-400" />
                  )}

                  <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 truncate">
                    {repo.repo_name}
                  </span>
                  {repo.status === 'indexing' && (
                    <svg
                      className="animate-spin h-4 w-4 text-gray-400 flex-shrink-0"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  )}
                </button>

                {/* Delete button - only on hover */}
                {hoveredId === repo.project_id && (
                  <div className="group/delete absolute right-2 top-1/2 -translate-y-1/2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRepoToDelete(repo)
                        setDeleteModalOpen(true)
                      }}
                      className="p-1.5 bg-white dark:bg-neutral-800 rounded-md hover:bg-accent-red-50 dark:hover:bg-accent-red-900/20 border border-neutral-200 dark:border-neutral-700 hover:border-accent-red-300 dark:hover:border-accent-red-700 transition-colors"
                      title="Delete repository"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400 group-hover/delete:text-accent-red-600 dark:group-hover/delete:text-accent-red-400 transition-colors" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && repoToDelete && (
        <DeleteRepoModal
          isOpen={deleteModalOpen}
          repoName={repoToDelete.repo_name}
          projectId={repoToDelete.project_id}
          onClose={() => {
            setDeleteModalOpen(false)
            setRepoToDelete(null)
          }}
          onConfirm={handleDeleteRepo}
        />
      )}
    </div>
  )
}

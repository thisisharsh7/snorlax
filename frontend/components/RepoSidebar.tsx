'use client'

import { useEffect, useState } from 'react'
import { Github, Trash2, Settings, Sun, Moon } from 'lucide-react'
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
}

export default function RepoSidebar({ selectedProjectId, onSelectRepo, onNewRepo, onSettingsClick, isDark, onToggleDarkMode }: RepoSidebarProps) {
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

      // Optimistic update - remove from list immediately
      setRepos(repos.filter(r => r.project_id !== projectId))

      // Clear selection if deleted repo was selected
      if (selectedProjectId === projectId) {
        onSelectRepo('')
      }

      // Refresh list from server
      await loadRepositories()
    } catch (e) {
      console.error('Failed to delete repository:', e)
      throw e
    }
  }

  return (
    <div className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300">
          Repositories
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="Toggle dark mode"
          >
            {isDark ? (
              <Sun className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            ) : (
              <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            )}
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="Settings - Configure API Keys"
          >
            <Settings className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          <button
            type="button"
            onClick={onNewRepo}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="Index New Repository"
          >
            <svg className="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
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
                  onClick={() => repo.status === 'indexed' && onSelectRepo(repo.project_id)}
                  disabled={repo.status !== 'indexed'}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-2.5 ${
                    selectedProjectId === repo.project_id
                      ? 'bg-gray-200 dark:bg-gray-800'
                      : 'hover:bg-gray-150 dark:hover:bg-gray-850'
                  } ${repo.status !== 'indexed' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Github className="w-5 h-5 flex-shrink-0 text-gray-700 dark:text-gray-300" />
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRepoToDelete(repo)
                      setDeleteModalOpen(true)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white dark:bg-gray-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 border border-gray-200 dark:border-gray-700 transition-colors"
                    title="Delete repository"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  </button>
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

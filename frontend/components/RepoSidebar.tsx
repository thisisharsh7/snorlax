'use client'

import { useEffect, useState } from 'react'
import { Github } from 'lucide-react'

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
}

export default function RepoSidebar({ selectedProjectId, onSelectRepo, onNewRepo, onSettingsClick }: RepoSidebarProps) {
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRepositories()
    const interval = setInterval(loadRepositories, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadRepositories() {
    try {
      const res = await fetch('http://localhost:8000/api/repositories')
      const data = await res.json()
      setRepos(data)
      setLoading(false)
    } catch (e) {
      console.error('Failed to load repositories:', e)
    }
  }

  return (
    <div className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300">
          Repositories
        </h2>
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
              <button
                type="button"
                key={repo.project_id}
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
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

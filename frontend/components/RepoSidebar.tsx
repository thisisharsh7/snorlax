'use client'

import { useEffect, useState } from 'react'

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
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    loadRepositories()
    // Refresh every 5 seconds to catch indexing updates
    const interval = setInterval(loadRepositories, 5000)
    return () => clearInterval(interval)
  }, [])

  // Initialize dark mode from actual DOM state
  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark')
    setIsDark(isDarkMode)
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

  function getStatusColor(status: string) {
    switch (status) {
      case 'indexed': return 'bg-green-100 text-green-700'
      case 'indexing': return 'bg-yellow-100 text-yellow-700'
      case 'failed': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'indexed': return '✓'
      case 'indexing': return '⏳'
      case 'failed': return '✗'
      default: return '◌'
    }
  }

  function formatTime(timestamp: string) {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return 'Just now'
  }

  return (
    <div className="w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">Repositories</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onSettingsClick}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Settings"
            >
              <span className="text-xl">⚙️</span>
            </button>
            <button
              onClick={() => {
                console.log('Before toggle - isDark:', isDark)
                console.log('Before toggle - DOM has dark:', document.documentElement.classList.contains('dark'))

                const newDarkMode = !isDark
                console.log('New dark mode will be:', newDarkMode)

                setIsDark(newDarkMode)
                if (newDarkMode) {
                  document.documentElement.classList.add('dark')
                } else {
                  document.documentElement.classList.remove('dark')
                }
                localStorage.setItem('darkMode', newDarkMode ? 'true' : 'false')

                console.log('After toggle - DOM has dark:', document.documentElement.classList.contains('dark'))
              }}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="text-xl">{isDark ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </div>
        <button
          onClick={onNewRepo}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
        >
          <span className="text-xl">+</span>
          Index New Repo
        </button>
      </div>

      {/* Repository List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            Loading...
          </div>
        ) : repos.length === 0 ? (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            <p className="text-4xl mb-3">📚</p>
            <p className="font-semibold mb-1">No repositories yet</p>
            <p className="text-sm">Click "Index New Repo" to get started</p>
          </div>
        ) : (
          <div className="p-2">
            {repos.map((repo) => (
              <button
                key={repo.project_id}
                onClick={() => repo.status === 'indexed' && onSelectRepo(repo.project_id)}
                disabled={repo.status !== 'indexed'}
                className={`w-full text-left p-3 rounded-lg mb-2 transition-all ${
                  selectedProjectId === repo.project_id
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-2 border-transparent'
                } ${repo.status !== 'indexed' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-200 flex-1 truncate">
                    {repo.repo_name}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(repo.status)} ml-2 flex-shrink-0`}>
                    {getStatusIcon(repo.status)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(repo.indexed_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

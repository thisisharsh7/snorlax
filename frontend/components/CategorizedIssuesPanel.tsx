'use client'

import { useState, useEffect } from 'react'

interface Category {
  category: string
  confidence: number
  reasoning: string
  related_issues: number[]
  related_prs: number[]
  related_files: string[]
}

interface CategorizedIssue {
  issue_number: number
  title: string
  state: string
  category: string
  confidence: number
  reasoning: string
  related_issues: number[]
  related_prs: number[]
  related_files: string[]
  theme_name?: string
  theme_description?: string
}

interface ThemeCluster {
  theme_name: string
  theme_description: string
  issues: CategorizedIssue[]
}

interface Props {
  projectId: string
  repoName: string
}

export default function CategorizedIssuesPanel({ projectId, repoName }: Props) {
  const [activeTab, setActiveTab] = useState<string>('all')
  const [issues, setIssues] = useState<CategorizedIssue[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [categorizing, setCategorizing] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<CategorizedIssue | null>(null)
  const [generatingComment, setGeneratingComment] = useState<number | null>(null)
  const [generatedComment, setGeneratedComment] = useState<string | null>(null)

  useEffect(() => {
    loadCategorizedIssues()
    loadStats()
  }, [projectId])

  async function loadCategorizedIssues() {
    setLoading(true)
    try {
      const res = await fetch(`http://localhost:8000/api/categorized-issues/${projectId}`)
      if (!res.ok) throw new Error('Failed to load issues')
      const data = await res.json()
      setIssues(data.issues || [])
    } catch (e) {
      console.error('Failed to load categorized issues:', e)
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    try {
      const res = await fetch(`http://localhost:8000/api/category-stats/${projectId}`)
      if (!res.ok) return
      const data = await res.json()
      setStats(data)
    } catch (e) {
      console.error('Failed to load stats:', e)
    }
  }

  async function handleCategorizeAll() {
    setCategorizing(true)
    try {
      const res = await fetch(`http://localhost:8000/api/categorize-issues/${projectId}`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to start categorization')

      // Poll for completion
      await new Promise(resolve => setTimeout(resolve, 5000))
      await loadCategorizedIssues()
      await loadStats()
    } catch (e) {
      console.error('Failed to categorize:', e)
    } finally {
      setCategorizing(false)
    }
  }

  async function handleGenerateComment(issue: CategorizedIssue) {
    setGeneratingComment(issue.issue_number)
    setGeneratedComment(null)
    try {
      const res = await fetch(
        `http://localhost:8000/api/generate-comment/${projectId}/${issue.issue_number}?category=${issue.category}`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error('Failed to generate comment')
      const data = await res.json()
      setGeneratedComment(data.comment)
    } catch (e) {
      console.error('Failed to generate comment:', e)
    } finally {
      setGeneratingComment(null)
    }
  }

  function getCategoryBadge(category: string, confidence: number) {
    const badges: Record<string, { color: string; icon: string; label: string }> = {
      duplicate: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: '🔴', label: 'Duplicate' },
      implemented: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: '✅', label: 'Implemented' },
      fixed_in_pr: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: '🔧', label: 'Fixed in PR' },
      theme_cluster: { color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', icon: '📦', label: 'Theme' },
    }

    const badge = badges[category] || { color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: '⚪', label: category }

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
        <span>{badge.icon}</span>
        {badge.label}
        <span className="text-[10px] opacity-75">({Math.round(confidence * 100)}%)</span>
      </span>
    )
  }

  function getFilteredIssues(): CategorizedIssue[] {
    if (activeTab === 'all') return issues
    return issues.filter(i => i.category === activeTab)
  }

  function groupByTheme(): ThemeCluster[] {
    const themeIssues = issues.filter(i => i.category === 'theme_cluster' && i.theme_name)
    const themes: Record<string, ThemeCluster> = {}

    themeIssues.forEach(issue => {
      if (!issue.theme_name) return
      if (!themes[issue.theme_name]) {
        themes[issue.theme_name] = {
          theme_name: issue.theme_name,
          theme_description: issue.theme_description || '',
          issues: []
        }
      }
      themes[issue.theme_name].issues.push(issue)
    })

    return Object.values(themes)
  }

  const filteredIssues = getFilteredIssues()
  const themeClusters = groupByTheme()

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {repoName} - Categorized Issues
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
              AI-powered issue categorization with full transparency
            </p>
          </div>
          <button
            onClick={handleCategorizeAll}
            disabled={categorizing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
          >
            {categorizing && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            {categorizing ? 'Categorizing...' : 'Categorize All Issues'}
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-4 mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.categorized_issues}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Categorized</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.by_category?.duplicate || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Duplicates</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.by_category?.implemented || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Implemented</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.by_category?.fixed_in_pr || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Fixed in PR</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.by_category?.theme_cluster || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Themes</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {['all', 'duplicate', 'implemented', 'fixed_in_pr', 'theme_cluster'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 font-medium text-sm transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {tab === 'all' ? 'All' : tab.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeTab === 'theme_cluster' && themeClusters.length > 0 ? (
          <div className="space-y-6">
            {themeClusters.map((cluster, idx) => (
              <div key={idx} className="bg-white dark:bg-gray-900 rounded-lg border-2 border-purple-200 dark:border-purple-800 p-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  📦 {cluster.theme_name}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {cluster.theme_description}
                </p>
                <div className="space-y-2">
                  {cluster.issues.map(issue => (
                    <div
                      key={issue.issue_number}
                      onClick={() => setSelectedIssue(issue)}
                      className="p-3 bg-purple-50 dark:bg-purple-900/10 rounded border border-purple-100 dark:border-purple-800 hover:border-purple-300 dark:hover:border-purple-600 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          #{issue.issue_number}
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">{issue.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
            <p className="text-lg font-semibold mb-2">No issues in this category</p>
            <p className="text-sm">Click "Categorize All Issues" to start</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredIssues.map((issue) => (
              <div
                key={issue.issue_number}
                className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    {getCategoryBadge(issue.category, issue.confidence)}
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                        #{issue.issue_number} {issue.title}
                      </h3>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
                        issue.state === 'open'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {issue.state}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedIssue(selectedIssue?.issue_number === issue.issue_number ? null : issue)}
                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm"
                  >
                    {selectedIssue?.issue_number === issue.issue_number ? 'Hide Details ▲' : 'Show Details ▼'}
                  </button>
                </div>

                {/* Full Transparency Section */}
                {selectedIssue?.issue_number === issue.issue_number && (
                  <div className="mt-4 space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                    {/* Reasoning */}
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-white mb-2">💡 AI Reasoning:</h4>
                      <p className="text-gray-700 dark:text-gray-300 text-sm">{issue.reasoning}</p>
                    </div>

                    {/* Evidence */}
                    <div className="grid grid-cols-3 gap-4">
                      {issue.related_issues.length > 0 && (
                        <div>
                          <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related Issues:</h5>
                          <div className="space-y-1">
                            {issue.related_issues.map(num => (
                              <div key={num} className="text-blue-600 dark:text-blue-400 text-sm">#{num}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {issue.related_prs.length > 0 && (
                        <div>
                          <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related PRs:</h5>
                          <div className="space-y-1">
                            {issue.related_prs.map(num => (
                              <div key={num} className="text-blue-600 dark:text-blue-400 text-sm">PR #{num}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {issue.related_files.length > 0 && (
                        <div>
                          <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related Files:</h5>
                          <div className="space-y-1">
                            {issue.related_files.slice(0, 3).map((file, idx) => (
                              <div key={idx} className="text-gray-600 dark:text-gray-400 text-xs font-mono truncate">
                                {file}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Generate Comment Button */}
                    <div>
                      <button
                        onClick={() => handleGenerateComment(issue)}
                        disabled={generatingComment === issue.issue_number}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
                      >
                        {generatingComment === issue.issue_number ? 'Generating...' : 'Generate Comment'}
                      </button>

                      {generatedComment && generatingComment !== issue.issue_number && (
                        <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                          <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">📝 Generated Comment:</h5>
                          <div className="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap">{generatedComment}</div>
                          <button
                            onClick={() => navigator.clipboard.writeText(generatedComment)}
                            className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                          >
                            Copy to Clipboard
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

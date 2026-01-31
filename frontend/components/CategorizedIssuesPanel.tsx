'use client'

import { useState, useEffect, useRef } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

interface Category {
  category: string
  confidence: number
  reasoning: string
  related_issues: number[]
  related_prs: number[]
  related_files: string[]
}

interface CategoryDetail {
  category: string
  confidence: number
  reasoning: string
  related_issues: number[]
  related_prs: number[]
  related_files: string[]
  theme_name?: string
  theme_description?: string
}

interface CategorizedIssue {
  issue_number: number
  title: string
  state: string

  // For "All" tab (grouped data)
  categories?: CategoryDetail[]  // Array of all categories
  primary_category?: string      // Highest confidence category
  primary_confidence?: number    // Highest confidence score

  // For category-specific tabs (single category)
  category?: string
  confidence?: number
  reasoning?: string
  related_issues?: number[]
  related_prs?: number[]
  related_files?: string[]
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
  const [error, setError] = useState<string | null>(null)
  const [estimatedCost, setEstimatedCost] = useState<number>(0)
  const [actualCost, setActualCost] = useState<number>(0)

  // Ref for immediate race condition checking
  const categorizingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      await loadCategorizedIssues()
      await loadStats()
    }

    loadData()

    return () => {
      controller.abort() // Cancel any pending requests on unmount
    }
  }, [projectId])

  async function loadCategorizedIssues() {
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(API_ENDPOINTS.categorizedIssues(projectId), {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) throw new Error('Failed to load issues')
      const data = await res.json()
      setIssues(data.issues || [])
    } catch (e: any) {
      console.error('Failed to load categorized issues:', e)
      if (e.name === 'AbortError') {
        setError('Request timed out. Please check your connection.')
      } else {
        setError(e.message || 'Failed to load categorized issues')
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadStats() {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(API_ENDPOINTS.categoryStats(projectId), {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) return
      const data = await res.json()
      setStats(data)

      // Calculate estimated cost for uncategorized issues
      // Average cost: $0.015 per issue
      const uncategorized = data.uncategorized_issues || 0
      setEstimatedCost(uncategorized * 0.015)
    } catch (e: any) {
      console.error('Failed to load stats:', e)
      // Stats are not critical, so don't show error to user
    }
  }

  async function handleCategorizeAll() {
    // Prevent multiple simultaneous categorization operations from rapid clicks
    if (categorizingRef.current) {
      return
    }

    categorizingRef.current = true
    setCategorizing(true)
    try {
      const res = await fetch(API_ENDPOINTS.categorizeIssues(projectId), {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to start categorization')

      // Poll for updates with exponential backoff
      let attempts = 0
      const maxAttempts = 15 // Max 15 attempts

      while (attempts < maxAttempts) {
        // Wait with increasing intervals: 2s, 3s, 4.5s, 6.75s, up to max 10s
        const delay = Math.min(2000 * Math.pow(1.5, attempts), 10000)
        await new Promise(resolve => setTimeout(resolve, delay))

        // Reload data to show progress
        await loadCategorizedIssues()
        await loadStats()

        attempts++
      }
    } catch (e) {
      console.error('Failed to categorize:', e)
      alert('Failed to categorize issues. Please try again.')
    } finally {
      categorizingRef.current = false
      setCategorizing(false)
    }
  }

  async function handleGenerateComment(issue: CategorizedIssue) {
    setGeneratingComment(issue.issue_number)
    setGeneratedComment(null)
    try {
      // Determine which category to use for comment generation
      const categoryToUse = issue.category || issue.primary_category
      if (!categoryToUse) {
        throw new Error('No category available for comment generation')
      }

      const res = await fetch(
        API_ENDPOINTS.generateComment(projectId, issue.issue_number, categoryToUse),
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
    console.log('[Filter Debug] activeTab:', activeTab)
    console.log('[Filter Debug] total issues:', issues.length)

    if (activeTab === 'all') {
      console.log('[Filter Debug] showing all issues')
      return issues
    }

    const filtered = issues.filter(i => {
      // For grouped data (All tab format)
      if (i.categories) {
        const matches = i.categories.some(cat => cat.category === activeTab)
        console.log(`[Filter Debug] Issue #${i.issue_number} categories:`, i.categories.map(c => c.category), 'matches:', matches)
        return matches
      }
      // For single category data (category tab format)
      console.log(`[Filter Debug] Issue #${i.issue_number} category:`, i.category, 'matches:', i.category === activeTab)
      return i.category === activeTab
    })

    console.log('[Filter Debug] filtered count:', filtered.length)
    return filtered
  }

  function groupByTheme(): ThemeCluster[] {
    const themeIssues = issues.filter(i => {
      // For grouped data format
      if (i.categories) {
        return i.categories.some(cat => cat.category === 'theme_cluster' && cat.theme_name)
      }
      // For single category format
      return i.category === 'theme_cluster' && i.theme_name
    })
    const themes: Record<string, ThemeCluster> = {}

    themeIssues.forEach(issue => {
      const themeName = issue.theme_name || issue.categories?.find(c => c.category === 'theme_cluster')?.theme_name
      const themeDesc = issue.theme_description || issue.categories?.find(c => c.category === 'theme_cluster')?.theme_description

      if (!themeName) return
      if (!themes[themeName]) {
        themes[themeName] = {
          theme_name: themeName,
          theme_description: themeDesc || '',
          issues: []
        }
      }
      themes[themeName].issues.push(issue)
    })

    return Object.values(themes)
  }

  const filteredIssues = getFilteredIssues()
  const themeClusters = groupByTheme()

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex justify-between items-center mb-4">
          {/* Stats */}
          {stats && (
            <div className="flex gap-8 items-center">
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.categorized_issues}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Categorized</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.by_category?.duplicate || 0}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Duplicates</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.by_category?.implemented || 0}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Implemented</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.by_category?.fixed_in_pr || 0}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Fixed in PR</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{stats.by_category?.theme_cluster || 0}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Themes</div>
              </div>
            </div>
          )}

          <div className="flex flex-col items-end gap-1">
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
            {!categorizing && estimatedCost > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Est. cost: ${estimatedCost.toFixed(3)}
              </span>
            )}
            {categorizing && actualCost > 0 && (
              <span className="text-xs text-green-600 dark:text-green-400 font-mono">
                Cost so far: ${actualCost.toFixed(4)}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mb-px">
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
        {error ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="text-center max-w-md">
              <p className="text-red-600 dark:text-red-400 font-semibold mb-2">{error}</p>
              <button
                onClick={() => { loadCategorizedIssues(); loadStats(); }}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeTab === 'theme_cluster' && themeClusters.length > 0 ? (
          <div className="space-y-6">
            {themeClusters.map((cluster) => (
              <div key={`theme-${cluster.theme_name}`} className="bg-white dark:bg-gray-900 rounded-lg border-2 border-purple-200 dark:border-purple-800 p-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  📦 {cluster.theme_name}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  {cluster.theme_description}
                </p>
                <div className="space-y-2">
                  {cluster.issues.map(issue => (
                    <div
                      key={`cluster-${cluster.theme_name}-issue-${issue.issue_number}`}
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
                    {/* Show all badges in "All" tab, single badge in category tabs */}
                    {activeTab === 'all' && issue.categories ? (
                      // All tab: show all category badges
                      <div className="flex flex-wrap gap-2">
                        {issue.categories.map((cat, idx) => (
                          <span key={idx}>
                            {getCategoryBadge(cat.category, cat.confidence)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      // Category-specific tab: show single badge
                      getCategoryBadge(
                        issue.category || issue.primary_category!,
                        issue.confidence || issue.primary_confidence!
                      )
                    )}
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
                {selectedIssue?.issue_number === issue.issue_number && (() => {
                  // Get the primary category data (for display in All tab or single category in specific tabs)
                  const primaryData = issue.categories
                    ? issue.categories[0]
                    : {
                        reasoning: issue.reasoning!,
                        related_issues: issue.related_issues!,
                        related_prs: issue.related_prs!,
                        related_files: issue.related_files!
                      }

                  return (
                    <div className="mt-4 space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                      {/* Show reasoning for all categories in All tab, or just the selected one */}
                      {issue.categories && activeTab === 'all' ? (
                        // Show all category reasonings in All tab
                        <div className="space-y-4">
                          {issue.categories.map((cat, idx) => (
                            <div key={idx} className="border-l-4 border-gray-300 dark:border-gray-600 pl-4">
                              <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                                {getCategoryBadge(cat.category, cat.confidence)} Reasoning:
                              </h4>
                              <p className="text-gray-700 dark:text-gray-300 text-sm">{cat.reasoning}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        // Show single category reasoning
                        <div>
                          <h4 className="font-semibold text-gray-900 dark:text-white mb-2">💡 AI Reasoning:</h4>
                          <p className="text-gray-700 dark:text-gray-300 text-sm">{primaryData.reasoning}</p>
                        </div>
                      )}

                      {/* Evidence - use primary category data */}
                      <div className="grid grid-cols-3 gap-4">
                        {primaryData.related_issues && primaryData.related_issues.length > 0 && (
                          <div>
                            <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related Issues:</h5>
                            <div className="space-y-1">
                              {primaryData.related_issues.map(num => (
                                <div key={`issue-${num}`} className="text-blue-600 dark:text-blue-400 text-sm">#{num}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {primaryData.related_prs && primaryData.related_prs.length > 0 && (
                          <div>
                            <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related PRs:</h5>
                            <div className="space-y-1">
                              {primaryData.related_prs.map(num => (
                                <div key={`pr-${num}`} className="text-blue-600 dark:text-blue-400 text-sm">PR #{num}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {primaryData.related_files && primaryData.related_files.length > 0 && (
                          <div>
                            <h5 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Related Files:</h5>
                            <div className="space-y-1">
                              {primaryData.related_files.slice(0, 3).map((file) => (
                                <div key={`file-${issue.issue_number}-${file}`} className="text-gray-600 dark:text-gray-400 text-xs font-mono truncate">
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
                  )
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

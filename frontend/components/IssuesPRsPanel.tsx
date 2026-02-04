'use client'

import { useState, useEffect, useRef } from 'react'
import { ExternalLink, XCircle, CheckCircle2, Wrench, Package, Sparkles, FileText, Check, HelpCircle } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/config'

interface Issue {
  number: number
  title: string
  state: string
  author: string
  created_at: string
  updated_at: string
  labels: string[]
  html_url: string
  body: string
}

interface SearchResult {
  issue_number: number
  title: string
  body: string
  state: string
  github_url: string
  similarity: number | null
}

interface CategorizedIssue {
  issue_number: number

  // For grouped data (API returns all categories - nested structure)
  categories?: Array<{
    category: string
    confidence: number
    reasoning: string
    related_issues?: number[]
    related_prs?: number[]
    related_files?: string[]
    theme_name?: string
    theme_description?: string
  }>
  primary_category?: string
  primary_confidence?: number

  // For filtered data (API returns specific category - flat structure)
  category?: string
  confidence?: number
  reasoning?: string
}

interface CategoryStats {
  total: number
  duplicates: number
  implemented: number
  fixed_in_pr: number
  themes: number
}

interface IssuesPRsPanelProps {
  projectId: string
  repoName: string
  lastSyncedAt: string | null
  onImport: () => void
  onOpenSettings: () => void
  onReindex: () => void
  isBackgroundSyncing?: boolean
  onOpenTriage: (issueNumber: number) => void
}

// Custom hook for debouncing values
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export default function IssuesPRsPanel({ projectId, repoName, lastSyncedAt, onImport, onOpenSettings, onReindex, isBackgroundSyncing, onOpenTriage }: IssuesPRsPanelProps) {
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'closed'>('open')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'duplicate' | 'implemented' | 'fixed_in_pr' | 'theme_cluster'>('all')

  // ✅ USE MAP INSTEAD OF ARRAY for O(1) lookups
  const [issuesMap, setIssuesMap] = useState<Map<number, Issue>>(new Map())

  // Convert Map to Array for display (sorted by created_at descending)
  const issues = Array.from(issuesMap.values()).sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const [categorizedIssues, setCategorizedIssues] = useState<CategorizedIssue[]>([])
  const [categoryStats, setCategoryStats] = useState<CategoryStats>({
    total: 0,
    duplicates: 0,
    implemented: 0,
    fixed_in_pr: 0,
    themes: 0
  })
  const [loading, setLoading] = useState(true)
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [categorizing, setCategorizing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState(false)
  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [showTokenPrompt, setShowTokenPrompt] = useState(false)
  const [estimatedCost, setEstimatedCost] = useState<number>(0)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchType, setSearchType] = useState<'semantic' | 'text' | null>(null)

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 500)

  // Refs for immediate race condition checking
  const importingRef = useRef(false)
  const categorizingRef = useRef(false)

  // Reset UI state when switching repositories
  useEffect(() => {
    setError(null)
    setImportSuccess(false)
    setShowTokenPrompt(false)
    setImporting(false)
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
    // Note: loading, issues, prs, activeTab, filters are handled by the data loading effect
  }, [projectId])

  // Execute search when debounced query changes
  useEffect(() => {
    if (debouncedSearchQuery.trim().length >= 3) {
      performSearch(debouncedSearchQuery)
    } else if (debouncedSearchQuery.trim().length === 0) {
      // Clear search when query is empty
      setSearchResults(null)
      setSearchError(null)
    }
  }, [debouncedSearchQuery, projectId])

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      await checkGithubToken()
      await loadCategoryStats()
      await loadCategorizedIssues()
      await loadIssues()
      // PR functionality removed - always load issues only
    }

    loadData()

    return () => {
      controller.abort() // Cancel any pending requests on unmount
    }
  }, [projectId, issueFilter, lastSyncedAt])

  // ✅ Efficiently sync issues when reindex completes
  useEffect(() => {
    if (!isBackgroundSyncing) return

    // When syncing starts, wait for it to complete then sync issues
    const checkInterval = setInterval(async () => {
      try {
        const res = await fetch(API_ENDPOINTS.status(projectId))
        const data = await res.json()

        if (data.status === 'indexed') {
          // Reindex completed - sync new issues efficiently
          console.log('✓ Reindex completed - syncing new issues...')
          await syncNewIssues()
          clearInterval(checkInterval)
        }
      } catch (err) {
        console.error('Failed to check reindex status:', err)
      }
    }, 3000) // Check every 3 seconds

    return () => clearInterval(checkInterval)
  }, [isBackgroundSyncing, projectId])

  async function checkGithubToken() {
    try {
      const res = await fetch(API_ENDPOINTS.settings())
      const data = await res.json()
      setHasGithubToken(data.github_token_set)
    } catch (e) {
      console.error('Failed to check GitHub token:', e)
    }
  }

  async function loadCategoryStats() {
    try {
      const res = await fetch(API_ENDPOINTS.categoryStats(projectId))
      if (!res.ok) return
      const data = await res.json()
      setCategoryStats({
        total: data.categorized_issues || 0,
        duplicates: data.by_category?.duplicate || 0,
        implemented: data.by_category?.implemented || 0,
        fixed_in_pr: data.by_category?.fixed_in_pr || 0,
        themes: data.by_category?.theme_cluster || 0
      })

      // Calculate estimated cost
      const uncategorized = data.uncategorized_issues || 0
      setEstimatedCost(uncategorized * 0.015)
    } catch (e) {
      console.error('Failed to load category stats:', e)
    }
  }

  async function loadCategorizedIssues() {
    try {
      setLoadingCategories(true)
      const res = await fetch(API_ENDPOINTS.categorizedIssues(projectId))
      if (!res.ok) return
      const data = await res.json()
      setCategorizedIssues(data.issues || [])
    } catch (e) {
      console.error('Failed to load categorized issues:', e)
    } finally {
      setLoadingCategories(false)
    }
  }

  async function loadIssues() {
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const stateParam = issueFilter === 'all' ? '' : `?state=${issueFilter}`
      const res = await fetch(`${API_ENDPOINTS.githubIssues(projectId)}${stateParam}`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to load issues')
      }

      const data = await res.json()

      // ✅ Convert array to Map for O(1) operations
      const newMap = new Map<number, Issue>()
      ;(data.issues || []).forEach((issue: Issue) => {
        newMap.set(issue.number, issue)
      })

      setIssuesMap(newMap)
    } catch (e: any) {
      if (e.name === 'AbortError') return // Ignore aborted requests
      console.error('Failed to load issues:', e)
      setError(e.message || 'Failed to load issues. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function syncNewIssues() {
    /**
     * ✅ EFFICIENT: Only update Map with new/changed issues
     * Preserves analyzed issues without re-fetching everything
     */
    try {
      const stateParam = issueFilter === 'all' ? '' : `?state=${issueFilter}`
      const res = await fetch(`${API_ENDPOINTS.githubIssues(projectId)}${stateParam}`)

      if (!res.ok) {
        console.error('Failed to sync issues')
        return
      }

      const data = await res.json()

      // Update Map with new/changed issues
      setIssuesMap(prevMap => {
        const newMap = new Map(prevMap) // Clone existing map
        let newCount = 0
        let updatedCount = 0

        ;(data.issues || []).forEach((issue: Issue) => {
          const existing = newMap.get(issue.number)

          if (!existing) {
            // NEW issue - add it
            newMap.set(issue.number, issue)
            newCount++
          } else if (existing.updated_at !== issue.updated_at) {
            // UPDATED issue - refresh data
            newMap.set(issue.number, issue)
            updatedCount++
          }
          // UNCHANGED issues are preserved automatically
        })

        if (newCount > 0 || updatedCount > 0) {
          console.log(`✓ Synced: ${newCount} new, ${updatedCount} updated issues`)
        }

        return newMap
      })
    } catch (err) {
      console.error('Failed to sync issues:', err)
    }
  }

  async function performSearch(query: string) {
    try {
      setIsSearching(true)
      setSearchError(null)

      const res = await fetch(API_ENDPOINTS.triageSearchSemantic(projectId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit: 20,
          min_similarity: 0.3,
          category_filter: null,
        }),
      })

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.')
        }
        throw new Error('Search failed')
      }

      const data = await res.json()
      setSearchResults(data.results)
      setSearchType(data.search_type || 'semantic')
    } catch (err: any) {
      console.error('Search failed:', err)
      setSearchError(err.message)
      setSearchResults([])
      setSearchType(null)
    } finally {
      setIsSearching(false)
    }
  }

  function handleClearSearch() {
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
    setSearchType(null)
  }

  async function handleImport() {
    // Check if GitHub token is configured
    if (!hasGithubToken) {
      setShowTokenPrompt(true)
      return
    }

    // Prevent multiple simultaneous import operations from rapid clicks
    if (importingRef.current) {
      return
    }

    importingRef.current = true
    setImporting(true)
    setError(null)
    setImportSuccess(false)
    try {
      // Import only issues (PR functionality removed)
      const issuesRes = await fetch(API_ENDPOINTS.importIssues(projectId), {
        method: 'POST'
      })

      if (!issuesRes.ok) {
        const data = await issuesRes.json()
        throw new Error(data.detail || 'Failed to import issues from GitHub')
      }

      // Get detailed import statistics
      const issuesData = await issuesRes.json()

      // Check if we hit the limit (might have more data to import)
      const issuesLimitReached = issuesData.imported >= 500

      if (issuesLimitReached) {
        setImportSuccess(true)
        setError(`Successfully imported ${issuesData.imported} issues. There may be more data available - click "Sync from GitHub" again to continue importing.`)
      } else {
        setImportSuccess(true)
        console.log(`Import complete: ${issuesData.imported} new issues`)
      }

      // Refresh the issues view
      await loadIssues()

      onImport()

      // Hide success message after 5 seconds (longer for large imports)
      setTimeout(() => {
        setImportSuccess(false)
        setError(null)
      }, 5000)
    } catch (e: any) {
      console.error('Failed to import:', e)
      setError(e.message || 'Failed to import from GitHub. Please check your settings and try again.')
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    if (days < 365) return `${Math.floor(days / 30)} months ago`
    return `${Math.floor(days / 365)} years ago`
  }

  function getStateColor(state: string, merged: boolean = false) {
    if (merged) return 'bg-accent-purple-50 text-accent-purple-600 dark:bg-accent-purple-900/20 dark:text-accent-purple-300'
    if (state === 'open') return 'bg-accent-green-50 text-accent-green-600 dark:bg-accent-green-900/20 dark:text-accent-green-300'
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
  }

  function getStateIcon(state: string, merged: boolean = false) {
    if (merged) return <Check className="w-3 h-3" />
    if (state === 'open') return <div className="w-3 h-3 rounded-full border-2 border-current" />
    return <Check className="w-3 h-3" />
  }

  // Filter issues based on category
  const getFilteredIssues = () => {
    if (categoryFilter === 'all') return issues

    const categorizedNumbers = categorizedIssues
      .filter(ci => {
        // Handle nested structure (when API returns all categories)
        if (ci.categories) {
          return ci.categories.some(cat => cat.category === categoryFilter)
        }
        // Handle flat structure (when API returns specific category)
        return ci.category === categoryFilter
      })
      .map(ci => ci.issue_number)

    return issues.filter(issue => categorizedNumbers.includes(issue.number))
  }

  const displayIssues = getFilteredIssues()

  function getCategoryBadge(category: string, confidence: number) {
    const badges: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
      duplicate: {
        color: 'bg-accent-red-50 text-accent-red-600 dark:bg-accent-red-900/20 dark:text-accent-red-300',
        icon: <XCircle className="w-3 h-3" />,
        label: 'Duplicate'
      },
      implemented: {
        color: 'bg-accent-green-50 text-accent-green-600 dark:bg-accent-green-900/20 dark:text-accent-green-300',
        icon: <CheckCircle2 className="w-3 h-3" />,
        label: 'Implemented'
      },
      fixed_in_pr: {
        color: 'bg-accent-blue-50 text-accent-blue-600 dark:bg-accent-blue-900/20 dark:text-accent-blue-300',
        icon: <Wrench className="w-3 h-3" />,
        label: 'Fixed in PR'
      },
      theme_cluster: {
        color: 'bg-accent-purple-50 text-accent-purple-600 dark:bg-accent-purple-900/20 dark:text-accent-purple-300',
        icon: <Package className="w-3 h-3" />,
        label: 'Theme'
      },
    }

    const badge = badges[category] || {
      color: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
      icon: <HelpCircle className="w-3 h-3" />,
      label: category
    }

    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${badge.color}`}>
        {badge.icon}
        {badge.label}
        <span className="text-[10px] opacity-75">({Math.round(confidence * 100)}%)</span>
      </span>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 dark:bg-neutral-900">
      {/* Semantic Search Bar */}
      <div className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search issues…"
              className="w-full pl-9 pr-9 py-1.5 text-base border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-accent-blue-400 focus:border-accent-blue-400 transition-shadow"
            />
            <button
              onClick={handleClearSearch}
              disabled={!searchQuery}
              className={`absolute inset-y-0 right-0 pr-3 flex items-center transition-colors ${
                searchQuery
                  ? 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer'
                  : 'text-neutral-300 dark:text-neutral-700 cursor-not-allowed'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isSearching && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            )}
          </div>
        </div>
        {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Type at least 3 characters to search...
          </p>
        )}
      </div>

      {/* Search Error */}
      {searchError && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Search error</h3>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">{searchError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Show search results when search is active */}
        {searchResults !== null && searchQuery.trim().length >= 3 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Found {searchResults.length} results for "{searchQuery}"
                </span>
                {searchType && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    searchType === 'semantic'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}>
                    {searchType === 'semantic'
                      ? <><Sparkles className="w-3 h-3" /> Semantic Search</>
                      : <><FileText className="w-3 h-3" /> Text Match</>
                    }
                  </span>
                )}
              </div>
            </div>
            {searchResults.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center text-gray-500 dark:text-gray-400">
                  <p className="text-lg font-semibold mb-2">No matching issues found</p>
                  <p className="text-sm">Try different keywords or lower the similarity threshold</p>
                </div>
              </div>
            ) : (
              searchResults.map((result) => (
                <div
                  key={result.issue_number}
                  onClick={() => onOpenTriage(result.issue_number)}
                  className="relative block bg-white dark:bg-neutral-900 rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-3.5 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm transition-all cursor-pointer"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(result.github_url, '_blank')
                    }}
                    className="absolute top-3.5 right-4 p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <div className="flex items-start gap-3 pr-10">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                          #{result.issue_number} {result.title}
                        </h3>
                        {result.similarity !== null && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            {Math.round(result.similarity * 100)}% match
                          </span>
                        )}
                      </div>
                      {result.body && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-2">
                          {result.body.substring(0, 200)}
                          {result.body.length > 200 ? '...' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          displayIssues.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {isBackgroundSyncing ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-lg font-semibold mb-2">Syncing issues...</p>
                    <p className="text-sm">Please wait while we import issues from GitHub</p>
                  </>
                ) : categoryFilter !== 'all' ? (
                  <>
                    <p className="text-lg font-semibold mb-2">No issues in this category</p>
                    <p className="text-sm">
                      <button
                        onClick={() => setCategoryFilter('all')}
                        className="text-blue-600 dark:text-blue-400 underline"
                      >
                        Clear filter
                      </button>
                      {' '}to see all issues
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold mb-2">No issues found</p>
                    <p className="text-sm">Click "Sync Issues/PRs" to import issues</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayIssues.map((issue) => {
                // Find category info for this issue
                const categoryInfo = categorizedIssues.find(ci => ci.issue_number === issue.number)

                return (
                <div
                  key={issue.number}
                  onClick={() => onOpenTriage(issue.number)}
                  className="relative block bg-white dark:bg-neutral-900 rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-3.5 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm transition-all cursor-pointer"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(issue.html_url, '_blank')
                    }}
                    className="absolute top-3.5 right-3 p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-3 pr-10">
                    {/* Only show state badge when viewing 'all' issues */}
                    {issueFilter === 'all' && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStateColor(issue.state)}`}>
                        {getStateIcon(issue.state)}
                        <span className="capitalize">{issue.state}</span>
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                          #{issue.number} {issue.title}
                        </h3>
                          <span className="text-neutral-400 dark:text-neutral-500">•</span>
                          <span className="text-sm text-neutral-500 dark:text-neutral-400">by {issue.author}</span>
                          <span className="text-neutral-400 dark:text-neutral-500">•</span>
                          <span className="text-sm text-neutral-500 dark:text-neutral-400">{formatDate(issue.created_at)}</span>
                        </div>
                      {/* Category Badge(s) - with confidence threshold */}
                      {categoryInfo && (() => {
                        const CONFIDENCE_THRESHOLD = 0.20; // 20% minimum

                        // Helper to filter categories by confidence
                        const filterByConfidence = (categories: any[]) => {
                          return categories.filter(cat => cat.confidence > CONFIDENCE_THRESHOLD);
                        };

                        if (categoryFilter === 'all' && categoryInfo.categories) {
                          // "All" filter: Show all badges above threshold
                          const validCategories = filterByConfidence(categoryInfo.categories);

                          if (validCategories.length === 0) return null;

                          return (
                            <div className="mt-1">
                              <div className="flex flex-wrap gap-1.5">
                                {validCategories.map((cat, idx) => (
                                  <span key={idx}>
                                    {getCategoryBadge(cat.category, cat.confidence)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        } else if (categoryFilter !== 'all' && categoryInfo.categories) {
                          // Specific filter: Show ONLY that category's badge if above threshold
                          const filteredCat = categoryInfo.categories.find(
                            cat => cat.category === categoryFilter
                          );

                          if (!filteredCat || filteredCat.confidence <= CONFIDENCE_THRESHOLD) {
                            return null; // Don't show badge if confidence too low
                          }

                          return (
                            <div className="mt-1">
                              {getCategoryBadge(filteredCat.category, filteredCat.confidence)}
                            </div>
                          );
                        } else {
                          // Fallback for flat structure (backward compatibility)
                          const confidence = categoryInfo.primary_confidence || categoryInfo.confidence || 0;

                          if (confidence <= CONFIDENCE_THRESHOLD) return null;

                          return (
                            <div className="mt-1">
                              {getCategoryBadge(
                                categoryInfo.primary_category || categoryInfo.category || '',
                                confidence
                              )}
                            </div>
                          );
                        }
                      })()}
                      {issue.labels.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {issue.labels.map((label) => (
                            <span key={`issue-${issue.number}-label-${label}`} className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded text-xs">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          )
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
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

// DISABLED: PR functionality removed for first version
// interface PullRequest {
//   number: number
//   title: string
//   state: string
//   author: string
//   created_at: string
//   updated_at: string
//   merged_at: string | null
//   labels: string[]
//   html_url: string
//   body: string
// }

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
  // onOpenPRTriage: (prNumber: number) => void // DISABLED: PR functionality removed
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
  // const [activeTab, setActiveTab] = useState<'issues' | 'prs'>('issues') // DISABLED: PR functionality removed
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'closed'>('open') // Changed default to 'open'
  // const [prFilter, setPrFilter] = useState<'all' | 'open' | 'closed' | 'merged'>('all') // DISABLED: PR functionality removed
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'duplicate' | 'implemented' | 'fixed_in_pr' | 'theme_cluster'>('all')
  const [issues, setIssues] = useState<Issue[]>([])
  // const [prs, setPrs] = useState<PullRequest[]>([]) // DISABLED: PR functionality removed
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
  }, [projectId, issueFilter])

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

      // Sort by created_at descending (newest first)
      const sortedIssues = (data.issues || []).sort((a: Issue, b: Issue) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      setIssues(sortedIssues)
    } catch (e: any) {
      if (e.name === 'AbortError') return // Ignore aborted requests
      console.error('Failed to load issues:', e)
      setError(e.message || 'Failed to load issues. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // DISABLED: PR functionality removed for first version
  // async function loadPRs() {
  //   setLoading(true)
  //   setError(null)
  //   try {
  //     const controller = new AbortController()
  //     const timeoutId = setTimeout(() => controller.abort(), 10000)

  //     const stateParam = prFilter === 'all' ? '' : `?state=${prFilter}`
  //     const res = await fetch(`${API_ENDPOINTS.githubPRs(projectId)}${stateParam}`, {
  //       signal: controller.signal
  //     })
  //     clearTimeout(timeoutId)

  //     if (!res.ok) {
  //       const data = await res.json()
  //       throw new Error(data.detail || 'Failed to load pull requests')
  //     }

  //     const data = await res.json()

  //     // Sort by created_at descending (newest first)
  //     const sortedPRs = (data.pull_requests || []).sort((a: PullRequest, b: PullRequest) => {
  //       return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  //     })

  //     setPrs(sortedPRs)
  //   } catch (e: any) {
  //     if (e.name === 'AbortError') return // Ignore aborted requests
  //     console.error('Failed to load PRs:', e)
  //     setError(e.message || 'Failed to load pull requests. Please try again.')
  //   } finally {
  //     setLoading(false)
  //   }
  // }

  // DISABLED: Categorization functionality removed for first version
  // async function handleCategorizeAll() {
  //   // Prevent multiple simultaneous categorization operations
  //   if (categorizingRef.current) {
  //     return
  //   }

  //   categorizingRef.current = true
  //   setCategorizing(true)
  //   try {
  //     const res = await fetch(API_ENDPOINTS.categorizeIssues(projectId), {
  //       method: 'POST'
  //     })
  //     if (!res.ok) throw new Error('Failed to start categorization')

  //     // Poll for updates with exponential backoff
  //     let attempts = 0
  //     const maxAttempts = 15

  //     while (attempts < maxAttempts) {
  //       const delay = Math.min(2000 * Math.pow(1.5, attempts), 10000)
  //       await new Promise(resolve => setTimeout(resolve, delay))

  //       await loadCategorizedIssues()
  //       await loadCategoryStats()

  //       attempts++
  //     }
  //   } catch (e) {
  //     console.error('Failed to categorize:', e)
  //     alert('Failed to categorize issues. Please try again.')
  //   } finally {
  //     categorizingRef.current = false
  //     setCategorizing(false)
  //   }
  // }

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
    if (merged) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    if (state === 'open') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }

  function getStateIcon(state: string, merged: boolean = false) {
    if (merged) return '✓'
    if (state === 'open') return '○'
    return '✓'
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

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* DISABLED: Header with Categorize Button and Tabs removed for first version */}

      {/* DISABLED: Category Filter Tabs - removed for first version */}
      {false && lastSyncedAt && categoryStats.total > 0 && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex gap-2">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === 'all'
                  ? 'bg-gray-900 dark:bg-gray-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                All
                {categoryStats.total > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">
                    {categoryStats.total}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setCategoryFilter('duplicate')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === 'duplicate'
                  ? 'bg-gray-900 dark:bg-gray-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                Duplicate
                {categoryStats.duplicates > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-300">
                    {categoryStats.duplicates}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setCategoryFilter('implemented')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === 'implemented'
                  ? 'bg-gray-900 dark:bg-gray-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                Implemented
                {categoryStats.implemented > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-green-200 dark:bg-green-900/50 text-green-700 dark:text-green-300">
                    {categoryStats.implemented}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setCategoryFilter('fixed_in_pr')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === 'fixed_in_pr'
                  ? 'bg-gray-900 dark:bg-gray-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                Fixed in PR
                {categoryStats.fixed_in_pr > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-blue-200 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                    {categoryStats.fixed_in_pr}
                  </span>
                )}
              </span>
            </button>
            <button
              onClick={() => setCategoryFilter('theme_cluster')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === 'theme_cluster'
                  ? 'bg-gray-900 dark:bg-gray-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                Theme Cluster
                {categoryStats.themes > 0 && (
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-purple-200 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                    {categoryStats.themes}
                  </span>
                )}
              </span>
            </button>
          </div>
        </div>
      )}


      {/* DISABLED: Active Category Filter Indicator - removed for first version */}
      {false && categoryFilter !== 'all' && (
        <div className="bg-blue-50 dark:bg-blue-900/20 px-6 py-2 border-b border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-blue-700 dark:text-blue-300">
              Showing {categoryFilter.replace('_', ' ')} issues
            </span>
            <button
              onClick={() => setCategoryFilter('all')}
              className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

      {/* Semantic Search Bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search issues semantically (e.g., 'authentication bugs', 'memory leaks')..."
              className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isSearching && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            )}
            <button
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              title="Search uses AI embeddings to find semantically similar issues, even if they use different words"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
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
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    searchType === 'semantic'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}>
                    {searchType === 'semantic' ? '🔮 Semantic Search' : '📝 Text Match'}
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
                  className="relative block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(result.github_url, '_blank')
                    }}
                    className="absolute top-4 right-4 p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <div className="flex items-start gap-3 pr-10">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 dark:text-white">
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
                  className="relative block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(issue.html_url, '_blank')
                    }}
                    className="absolute top-4 right-4 p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <div className="flex items-start gap-3 pr-10">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStateColor(issue.state)} mt-1`}>
                      {getStateIcon(issue.state)} {issue.state}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                        #{issue.number} {issue.title}
                      </h3>
                      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                        <span>by {issue.author}</span>
                        <span>{formatDate(issue.created_at)}</span>
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
                            <div className="mt-2">
                              <div className="flex flex-wrap gap-2">
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
                            <div className="mt-2">
                              {getCategoryBadge(filteredCat.category, filteredCat.confidence)}
                            </div>
                          );
                        } else {
                          // Fallback for flat structure (backward compatibility)
                          const confidence = categoryInfo.primary_confidence || categoryInfo.confidence || 0;

                          if (confidence <= CONFIDENCE_THRESHOLD) return null;

                          return (
                            <div className="mt-2">
                              {getCategoryBadge(
                                categoryInfo.primary_category || categoryInfo.category || '',
                                confidence
                              )}
                            </div>
                          );
                        }
                      })()}
                      {issue.labels.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {issue.labels.map((label) => (
                            <span key={`issue-${issue.number}-label-${label}`} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
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
        {/* DISABLED: PR display section removed for first version */}
      </div>
    </div>
  )
}

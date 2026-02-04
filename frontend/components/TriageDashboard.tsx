'use client'

import { useState, useEffect, useRef } from 'react'
import { Flame, Bug, Lightbulb, HelpCircle, Trash2, PartyPopper } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/config'

interface Issue {
  issue_number: number
  title: string
  confidence: number
  priority_score: number
}

interface SearchResult {
  issue_number: number
  title: string
  body: string
  state: string
  github_url: string
  similarity: number
}

interface DashboardData {
  today_count: number
  needs_triage_count: number
  categories: {
    critical: Issue[]
    bugs: Issue[]
    feature_requests: Issue[]
    questions: Issue[]
    low_priority: Issue[]
  }
}

interface TriageDashboardProps {
  projectId: string
  onEnterTriageMode: () => void
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

interface CategorySectionProps {
  icon: React.ReactNode
  title: string
  count: number
  issues: Issue[]
  collapsible?: boolean
  defaultExpanded?: boolean
}

function CategorySection({
  icon,
  title,
  count,
  issues,
  collapsible = true,
  defaultExpanded = false
}: CategorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (count === 0) {
    return null
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => collapsible && setIsExpanded(!isExpanded)}
        className={`w-full px-4 py-3 flex items-center justify-between ${
          collapsible ? 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer' : 'cursor-default'
        } transition-colors`}
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">{icon}</div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {count} {count === 1 ? 'issue' : 'issues'}
            </p>
          </div>
        </div>
        {collapsible && (
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {(isExpanded || !collapsible) && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {issues.map((issue) => (
            <div
              key={issue.issue_number}
              className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-600 last:border-b-0 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <a
                    href={`#issue-${issue.issue_number}`}
                    className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    #{issue.issue_number}: {issue.title}
                  </a>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Confidence: {Math.round(issue.confidence * 100)}%
                    </span>
                    {issue.priority_score > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        • Priority: {issue.priority_score}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TriageDashboard({ projectId, onEnterTriageMode }: TriageDashboardProps) {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 500)

  useEffect(() => {
    loadDashboardData()
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

  async function loadDashboardData() {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch(API_ENDPOINTS.triageDashboard(projectId))

      if (!res.ok) {
        throw new Error('Failed to load dashboard data')
      }

      const data = await res.json()
      setDashboardData(data)
    } catch (err: any) {
      console.error('Failed to load dashboard:', err)
      setError(err.message)
    } finally {
      setLoading(false)
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
    } catch (err: any) {
      console.error('Search failed:', err)
      setSearchError(err.message)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  function handleClearSearch() {
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Error loading dashboard</h3>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
            <button
              onClick={loadDashboardData}
              className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!dashboardData) {
    return null
  }

  const totalIssues =
    dashboardData.categories.critical.length +
    dashboardData.categories.bugs.length +
    dashboardData.categories.feature_requests.length +
    dashboardData.categories.questions.length +
    dashboardData.categories.low_priority.length

  const isSearchActive = searchResults !== null || searchQuery.trim().length >= 3

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 rounded-lg p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold mb-2">Triage Dashboard</h2>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="opacity-90">Triaged today:</span>{' '}
                <span className="font-semibold text-lg">{dashboardData.today_count}</span>
              </div>
              <div>
                <span className="opacity-90">Needs triage:</span>{' '}
                <span className="font-semibold text-lg">{dashboardData.needs_triage_count}</span>
              </div>
              <div>
                <span className="opacity-90">Total categorized:</span>{' '}
                <span className="font-semibold text-lg">{totalIssues}</span>
              </div>
            </div>
          </div>
          {dashboardData.needs_triage_count > 0 && (
            <button
              onClick={onEnterTriageMode}
              className="bg-white text-blue-600 px-6 py-3 rounded-md font-semibold text-sm hover:bg-blue-50 transition-colors shadow-lg"
            >
              Enter Triage Mode
            </button>
          )}
        </div>
      </div>

      {/* Semantic Search Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
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
              className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleClearSearch}
              disabled={!searchQuery}
              className={`absolute inset-y-0 right-0 pr-3 flex items-center transition-colors ${
                searchQuery
                  ? 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer'
                  : 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
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

      {/* Search Results */}
      {isSearchActive && searchResults !== null && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Search Results ({searchResults.length})
            </h3>
            {searchResults.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                No issues found matching your query. Try different keywords or lower the similarity threshold.
              </p>
            )}
          </div>
          {searchResults.length > 0 && (
            <div>
              {searchResults.map((result) => (
                <div
                  key={result.issue_number}
                  className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-600 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <a
                          href={result.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          #{result.issue_number}: {result.title}
                        </a>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {Math.round(result.similarity * 100)}% match
                        </span>
                      </div>
                      {result.body && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                          {result.body.substring(0, 200)}
                          {result.body.length > 200 ? '...' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category sections - only show when not searching */}
      {!isSearchActive && (
        <>
          {/* No issues message */}
          {totalIssues === 0 && dashboardData.needs_triage_count === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <PartyPopper className="w-16 h-16 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                No issues to triage!
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                All issues have been processed or there are no open issues.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Critical - Always expanded */}
              <CategorySection
                icon={<Flame className="w-6 h-6 text-red-500" />}
                title="Critical"
                count={dashboardData.categories.critical.length}
                issues={dashboardData.categories.critical}
                collapsible={false}
                defaultExpanded={true}
              />

              {/* Bugs */}
              <CategorySection
                icon={<Bug className="w-6 h-6 text-orange-500" />}
                title="Bugs"
                count={dashboardData.categories.bugs.length}
                issues={dashboardData.categories.bugs}
                collapsible={true}
                defaultExpanded={false}
              />

              {/* Feature Requests */}
              <CategorySection
                icon={<Lightbulb className="w-6 h-6 text-blue-500" />}
                title="Feature Requests"
                count={dashboardData.categories.feature_requests.length}
                issues={dashboardData.categories.feature_requests}
                collapsible={true}
                defaultExpanded={false}
              />

              {/* Questions */}
              <CategorySection
                icon={<HelpCircle className="w-6 h-6 text-purple-500" />}
                title="Questions"
                count={dashboardData.categories.questions.length}
                issues={dashboardData.categories.questions}
                collapsible={true}
                defaultExpanded={false}
              />

              {/* Low Priority */}
              <CategorySection
                icon={<Trash2 className="w-6 h-6 text-gray-500" />}
                title="Low Priority"
                count={dashboardData.categories.low_priority.length}
                issues={dashboardData.categories.low_priority}
                collapsible={true}
                defaultExpanded={false}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

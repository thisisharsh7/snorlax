'use client'

import { useState, useEffect } from 'react'

interface Issue {
  issue_number: number
  title: string
  confidence: number
  priority_score: number
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

interface CategorySectionProps {
  icon: string
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
          <span className="text-2xl">{icon}</span>
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

  useEffect(() => {
    loadDashboardData()
  }, [projectId])

  async function loadDashboardData() {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch(`http://localhost:8000/api/triage/dashboard/${projectId}`)

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

      {/* No issues message */}
      {totalIssues === 0 && dashboardData.needs_triage_count === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-6xl mb-4">🎉</div>
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
            icon="🔥"
            title="Critical"
            count={dashboardData.categories.critical.length}
            issues={dashboardData.categories.critical}
            collapsible={false}
            defaultExpanded={true}
          />

          {/* Bugs */}
          <CategorySection
            icon="🐛"
            title="Bugs"
            count={dashboardData.categories.bugs.length}
            issues={dashboardData.categories.bugs}
            collapsible={true}
            defaultExpanded={false}
          />

          {/* Feature Requests */}
          <CategorySection
            icon="💡"
            title="Feature Requests"
            count={dashboardData.categories.feature_requests.length}
            issues={dashboardData.categories.feature_requests}
            collapsible={true}
            defaultExpanded={false}
          />

          {/* Questions */}
          <CategorySection
            icon="❓"
            title="Questions"
            count={dashboardData.categories.questions.length}
            issues={dashboardData.categories.questions}
            collapsible={true}
            defaultExpanded={false}
          />

          {/* Low Priority */}
          <CategorySection
            icon="🗑️"
            title="Low Priority"
            count={dashboardData.categories.low_priority.length}
            issues={dashboardData.categories.low_priority}
            collapsible={true}
            defaultExpanded={false}
          />
        </div>
      )}
    </div>
  )
}

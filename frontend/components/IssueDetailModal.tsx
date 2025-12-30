'use client'

import { useState, useEffect } from 'react'

interface IssueDetail {
  issue_number: number
  title: string
  body: string
  state: string
  author: string
  created_at: string
  updated_at: string
  labels: string[]
  comments_count: number
  github_url: string
  ai_analysis: {
    category: string | null
    suggested_action: string | null
    suggested_response: string | null
    confidence_score: number | null
    already_implemented: boolean
    matching_files: string[]
  }
  duplicates: Array<{
    issue_number: number
    title: string
    state: string
    similarity_score: number
  }>
}

interface Props {
  projectId: string
  issueNumber: number
  onClose: () => void
}

export default function IssueDetailModal({ projectId, issueNumber, onClose }: Props) {
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadIssueDetail()
  }, [projectId, issueNumber])

  async function loadIssueDetail() {
    setLoading(true)
    try {
      const res = await fetch(`http://localhost:8000/api/github/issue-detail/${projectId}/${issueNumber}`)
      if (!res.ok) throw new Error('Failed to load issue detail')

      const data = await res.json()
      setIssue(data)
    } catch (e) {
      console.error('Failed to load issue detail:', e)
    } finally {
      setLoading(false)
    }
  }

  function copyResponse() {
    if (issue?.ai_analysis.suggested_response) {
      navigator.clipboard.writeText(issue.ai_analysis.suggested_response)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function getCategoryColor(category: string | null) {
    const colors = {
      duplicate: 'text-red-600 dark:text-red-400',
      can_close: 'text-green-600 dark:text-green-400',
      potential_duplicate: 'text-yellow-600 dark:text-yellow-400',
      normal: 'text-blue-600 dark:text-blue-400'
    }
    return colors[category as keyof typeof colors] || 'text-gray-600 dark:text-gray-400'
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : issue ? (
          <div className="flex flex-col h-full max-h-[90vh]">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-start mb-2">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  #{issue.issue_number} {issue.title}
                </h2>
                <button
                  onClick={onClose}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>by @{issue.author}</span>
                <span>•</span>
                <span>Created {formatDate(issue.created_at)}</span>
                <span>•</span>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  issue.state === 'open'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {issue.state}
                </span>
                <span>•</span>
                <span>{issue.comments_count} comments</span>
              </div>
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* AI Analysis Section */}
              {issue.ai_analysis.category && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-3 mb-4">
                    <span className="text-3xl">🤖</span>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                        AI Analysis
                      </h3>
                      <div className="flex items-center gap-3 text-sm">
                        <span className={`font-medium ${getCategoryColor(issue.ai_analysis.category)}`}>
                          Category: {issue.ai_analysis.category.replace('_', ' ').toUpperCase()}
                        </span>
                        {issue.ai_analysis.confidence_score && (
                          <span className="text-gray-600 dark:text-gray-400">
                            • Confidence: {issue.ai_analysis.confidence_score}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Suggested Response */}
                  {issue.ai_analysis.suggested_response && (
                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
                          Suggested Response:
                        </h4>
                        <button
                          onClick={copyResponse}
                          className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                        >
                          {copied ? '✓ Copied!' : '📋 Copy Response'}
                        </button>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border border-gray-200 dark:border-gray-700">
                        {issue.ai_analysis.suggested_response}
                      </div>
                    </div>
                  )}

                  {/* Already Implemented */}
                  {issue.ai_analysis.already_implemented && issue.ai_analysis.matching_files.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">
                        ✓ Already Implemented In:
                      </h4>
                      <div className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700">
                        {issue.ai_analysis.matching_files.map((file, idx) => (
                          <div key={idx} className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                            📄 {file}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Duplicates Section */}
              {issue.duplicates.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6 border border-red-200 dark:border-red-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">
                    🔴 Potential Duplicates
                  </h3>
                  <div className="space-y-2">
                    {issue.duplicates.map((dup) => (
                      <div
                        key={dup.issue_number}
                        className="bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <a
                              href={`https://github.com/${projectId}/issues/${dup.issue_number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              #{dup.issue_number} {dup.title}
                            </a>
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                              {dup.state} • {dup.similarity_score}% similar
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Issue Body */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">
                  Issue Description
                </h3>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border border-gray-200 dark:border-gray-700">
                  {issue.body || 'No description provided.'}
                </div>
              </div>

              {/* Labels */}
              {issue.labels.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">
                    Labels
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    {issue.labels.map((label, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-sm"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex justify-between items-center">
                <a
                  href={issue.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Open on GitHub →
                </a>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            Failed to load issue details
          </div>
        )}
      </div>
    </div>
  )
}

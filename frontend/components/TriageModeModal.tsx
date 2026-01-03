'use client'

import { useState, useEffect, useCallback } from 'react'

interface Issue {
  issue_number: number
  title: string
  body: string
  state: string
  created_at: string
}

interface TriageAnalysis {
  issue_number: number
  title: string
  primary_category: string
  confidence: number
  reasoning: string
  duplicate_of: number | null
  related_prs: number[]
  doc_links: Array<{ file: string; line: number; similarity: number }>
  suggested_responses: Array<{
    type: string
    title: string
    body: string
    actions: string[]
  }>
  priority_score: number
  needs_response: boolean
  tags: string[]
}

interface TriageModeModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', label: '🔥 Critical' },
  bug: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300', label: '🐛 Bug' },
  feature_request: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', label: '💡 Feature Request' },
  question: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: '❓ Question' },
  low_priority: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-300', label: '🗑️ Low Priority' }
}

export default function TriageModeModal({ projectId, isOpen, onClose }: TriageModeModalProps) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [analysis, setAnalysis] = useState<TriageAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [copiedResponse, setCopiedResponse] = useState<number | null>(null)

  // Load uncategorized issues
  useEffect(() => {
    if (isOpen) {
      loadUncategorizedIssues()
    }
  }, [isOpen, projectId])

  // Analyze current issue when index changes
  useEffect(() => {
    if (issues.length > 0 && currentIndex >= 0 && currentIndex < issues.length) {
      analyzeCurrentIssue()
    }
  }, [currentIndex, issues])

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    function handleKeyPress(e: KeyboardEvent) {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return
      }

      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          nextIssue()
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          previousIssue()
          break
        case '1':
          e.preventDefault()
          copyResponse(0)
          break
        case '2':
          e.preventDefault()
          copyResponse(1)
          break
        case '3':
          e.preventDefault()
          copyResponse(2)
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isOpen, currentIndex, issues, analysis])

  async function loadUncategorizedIssues() {
    try {
      setLoading(true)
      const res = await fetch(`http://localhost:8000/api/triage/issues/${projectId}/uncategorized`)

      if (!res.ok) {
        throw new Error('Failed to load issues')
      }

      const data = await res.json()
      setIssues(data)
      setCurrentIndex(0)
    } catch (err) {
      console.error('Failed to load uncategorized issues:', err)
    } finally {
      setLoading(false)
    }
  }

  async function analyzeCurrentIssue() {
    if (!issues[currentIndex]) return

    try {
      setAnalyzing(true)
      setAnalysis(null)

      const res = await fetch(
        `http://localhost:8000/api/triage/analyze/${projectId}/${issues[currentIndex].issue_number}`,
        { method: 'POST' }
      )

      if (!res.ok) {
        throw new Error('Failed to analyze issue')
      }

      const data = await res.json()
      setAnalysis(data)
    } catch (err) {
      console.error('Failed to analyze issue:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  function nextIssue() {
    if (currentIndex < issues.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  function previousIssue() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  async function copyResponse(index: number) {
    if (!analysis?.suggested_responses[index]) return

    const response = analysis.suggested_responses[index]

    try {
      await navigator.clipboard.writeText(response.body)
      setCopiedResponse(index)
      setTimeout(() => setCopiedResponse(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (!isOpen) return null

  const currentIssue = issues[currentIndex]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-6">
      <div className="bg-white dark:bg-gray-900 w-full h-full rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gray-900 dark:bg-gray-950 text-white px-6 py-4 flex items-center justify-between border-b border-gray-700">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold">Triage Mode</h2>
            {issues.length > 0 && (
              <span className="text-sm text-gray-400">
                Issue {currentIndex + 1} of {issues.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Loading issues...</p>
              </div>
            </div>
          ) : issues.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  All caught up!
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  No more issues to triage.
                </p>
                <button
                  onClick={onClose}
                  className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Issue Display */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    #{currentIssue.issue_number}: {currentIssue.title}
                  </h3>
                </div>
                <div className="prose dark:prose-invert max-w-none text-sm text-gray-700 dark:text-gray-300">
                  <pre className="whitespace-pre-wrap font-sans bg-white dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700">
                    {currentIssue.body || 'No description provided'}
                  </pre>
                </div>
              </div>

              {/* AI Analysis Section */}
              {analyzing ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-5 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <p className="text-sm text-blue-800 dark:text-blue-300 font-medium">
                      Analyzing issue with Claude AI...
                    </p>
                  </div>
                </div>
              ) : analysis ? (
                <div className="space-y-4">
                  {/* Category Badge */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      AI Analysis
                    </h4>
                    <div className="flex items-center gap-3 mb-4">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                          CATEGORY_COLORS[analysis.primary_category]?.bg || 'bg-gray-100'
                        } ${CATEGORY_COLORS[analysis.primary_category]?.text || 'text-gray-800'}`}
                      >
                        {CATEGORY_COLORS[analysis.primary_category]?.label || analysis.primary_category}
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Confidence: {Math.round(analysis.confidence * 100)}%
                      </span>
                      {analysis.priority_score > 0 && (
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          • Priority: {analysis.priority_score}/100
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.reasoning}</p>

                    {/* Additional Info */}
                    {(analysis.duplicate_of || analysis.related_prs.length > 0 || analysis.doc_links.length > 0) && (
                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
                        {analysis.duplicate_of && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300">Duplicate of:</span>{' '}
                            <span className="text-blue-600 dark:text-blue-400">#{analysis.duplicate_of}</span>
                          </div>
                        )}
                        {analysis.related_prs.length > 0 && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300">Related PRs:</span>{' '}
                            {analysis.related_prs.map((pr, i) => (
                              <span key={pr}>
                                <span className="text-blue-600 dark:text-blue-400">#{pr}</span>
                                {i < analysis.related_prs.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                        {analysis.doc_links.length > 0 && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300">Related Docs:</span>
                            <ul className="mt-1 ml-4 space-y-1">
                              {analysis.doc_links.slice(0, 3).map((doc, i) => (
                                <li key={i} className="text-blue-600 dark:text-blue-400 truncate">
                                  {doc.file} ({Math.round(doc.similarity * 100)}% match)
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Suggested Responses */}
                  {analysis.suggested_responses.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Suggested Responses
                      </h4>
                      <div className="space-y-3">
                        {analysis.suggested_responses.map((response, index) => (
                          <div
                            key={index}
                            className="bg-gray-50 dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                  {index + 1}.
                                </span>{' '}
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                  {response.title}
                                </span>
                              </div>
                              <button
                                onClick={() => copyResponse(index)}
                                className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors"
                              >
                                {copiedResponse === index ? '✓ Copied' : 'Copy'}
                              </button>
                            </div>
                            <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
                              {response.body}
                            </pre>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {response.actions.map((action, i) => (
                                <span
                                  key={i}
                                  className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                                >
                                  {action}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer with Keyboard Shortcuts */}
        <div className="bg-gray-100 dark:bg-gray-800 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-6">
              <span><kbd className="kbd">J</kbd> / <kbd className="kbd">K</kbd> Next/Prev</span>
              <span><kbd className="kbd">1</kbd>/<kbd className="kbd">2</kbd>/<kbd className="kbd">3</kbd> Copy response</span>
              <span><kbd className="kbd">Esc</kbd> Exit</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={previousIssue}
                disabled={currentIndex === 0}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={nextIssue}
                disabled={currentIndex >= issues.length - 1}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .kbd {
          display: inline-block;
          padding: 2px 6px;
          background: rgba(0, 0, 0, 0.1);
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 3px;
          font-family: monospace;
          font-weight: 600;
        }
        .dark .kbd {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  )
}

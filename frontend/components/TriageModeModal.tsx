'use client'

import { useState, useEffect, useRef } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

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

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] || { bg: 'bg-gray-100', text: 'text-gray-800', label: category }
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors.bg} ${colors.text}`}>
      {colors.label}
    </span>
  )
}

export default function TriageModeModal({ projectId, isOpen, onClose }: TriageModeModalProps) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [analysis, setAnalysis] = useState<TriageAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [copiedResponse, setCopiedResponse] = useState<number | null>(null)
  const [analyzedIssues, setAnalyzedIssues] = useState<Map<number, TriageAnalysis>>(new Map())
  const [issueBodyExpanded, setIssueBodyExpanded] = useState(false)
  const [postingResponse, setPostingResponse] = useState<number | null>(null)
  const [postedResponse, setPostedResponse] = useState<number | null>(null)

  // Refs for keyboard handler (to avoid stale closures)
  const currentIndexRef = useRef(currentIndex)
  const issuesRef = useRef(issues)
  const analysisRef = useRef(analysis)

  // Keep refs in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    issuesRef.current = issues
  }, [issues])

  useEffect(() => {
    analysisRef.current = analysis
  }, [analysis])

  // Load uncategorized issues
  useEffect(() => {
    if (isOpen) {
      loadUncategorizedIssues()
      setAnalyzedIssues(new Map()) // Clear cache on open
    }
  }, [isOpen, projectId])

  // Keyboard shortcuts - FIXED: Only depends on isOpen
  useEffect(() => {
    if (!isOpen) return

    function handleKeyPress(e: KeyboardEvent) {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return
      }

      const index = currentIndexRef.current
      const issuesList = issuesRef.current
      const currentAnalysis = analysisRef.current

      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (index < issuesList.length - 1) {
            const nextIndex = index + 1
            setCurrentIndex(nextIndex)
            setAnalysis(null)
            setIssueBodyExpanded(false)

            // Check if next issue already analyzed
            const nextIssueNumber = issuesList[nextIndex].issue_number
            const cached = analyzedIssues.get(nextIssueNumber)
            if (cached) {
              setAnalysis(cached)
            }
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (index > 0) {
            const prevIndex = index - 1
            setCurrentIndex(prevIndex)
            setAnalysis(null)
            setIssueBodyExpanded(false)

            // Check if previous issue already analyzed
            const prevIssueNumber = issuesList[prevIndex].issue_number
            const cached = analyzedIssues.get(prevIssueNumber)
            if (cached) {
              setAnalysis(cached)
            }
          }
          break
        case '1':
          e.preventDefault()
          if (currentAnalysis?.suggested_responses?.[0]) {
            copyResponse(0)
          }
          break
        case '2':
          e.preventDefault()
          if (currentAnalysis?.suggested_responses?.[1]) {
            copyResponse(1)
          }
          break
        case '3':
          e.preventDefault()
          if (currentAnalysis?.suggested_responses?.[2]) {
            copyResponse(2)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isOpen, analyzedIssues, onClose])

  async function loadUncategorizedIssues() {
    try {
      setLoading(true)
      const res = await fetch(API_ENDPOINTS.triageUncategorized(projectId))

      if (!res.ok) {
        throw new Error('Failed to load issues')
      }

      const data = await res.json()
      setIssues(data)
      setCurrentIndex(0)
      setAnalysis(null)
    } catch (err) {
      console.error('Failed to load uncategorized issues:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAnalyzeClick() {
    if (!issues[currentIndex]) return

    const issueNumber = issues[currentIndex].issue_number

    // Check cache first
    if (analyzedIssues.has(issueNumber)) {
      setAnalysis(analyzedIssues.get(issueNumber)!)
      return
    }

    // Run analysis
    try {
      setAnalyzing(true)

      const res = await fetch(
        API_ENDPOINTS.triageAnalyze(projectId, issueNumber),
        { method: 'POST' }
      )

      if (!res.ok) {
        throw new Error('Failed to analyze issue')
      }

      const data = await res.json()

      // Cache result
      setAnalyzedIssues(prev => new Map(prev).set(issueNumber, data))
      setAnalysis(data)
    } catch (err) {
      console.error('Failed to analyze issue:', err)
    } finally {
      setAnalyzing(false)
    }
  }

  function nextIssue() {
    if (currentIndex < issues.length - 1) {
      const nextIndex = currentIndex + 1
      setCurrentIndex(nextIndex)
      setAnalysis(null)
      setIssueBodyExpanded(false)

      // Check if already analyzed
      const nextIssueNumber = issues[nextIndex].issue_number
      if (analyzedIssues.has(nextIssueNumber)) {
        setAnalysis(analyzedIssues.get(nextIssueNumber)!)
      }
    }
  }

  function previousIssue() {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1
      setCurrentIndex(prevIndex)
      setAnalysis(null)
      setIssueBodyExpanded(false)

      // Check if already analyzed
      const prevIssueNumber = issues[prevIndex].issue_number
      if (analyzedIssues.has(prevIssueNumber)) {
        setAnalysis(analyzedIssues.get(prevIssueNumber)!)
      }
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

  async function postResponseToGitHub(index: number) {
    if (!analysis?.suggested_responses[index]) return

    const response = analysis.suggested_responses[index]
    const currentIssue = issues[currentIndex]

    setPostingResponse(index)

    try {
      const res = await fetch(
        API_ENDPOINTS.postComment(projectId, currentIssue.issue_number),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_body: response.body })
        }
      )

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'Failed to post comment')
      }

      const result = await res.json()

      setPostedResponse(index)
      setTimeout(() => setPostedResponse(null), 3000)

      console.log('Comment posted successfully:', result.comment_url)
    } catch (err: any) {
      console.error('Failed to post to GitHub:', err)
      alert(`Failed to post comment: ${err.message}`)
    } finally {
      setPostingResponse(null)
    }
  }

  if (!isOpen) return null

  const currentIssue = issues[currentIndex]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 w-[95%] h-[95%] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center rounded-t-xl">
          <h2 className="text-xl font-bold">Triage Mode</h2>
          <div className="flex items-center gap-4">
            {issues.length > 0 && (
              <span className="text-sm text-gray-400">
                Issue {currentIndex + 1} of {issues.length}
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading issues...</p>
            </div>
          </div>
        ) : issues.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
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
          <>
            {/* Two-column layout */}
            <div className="flex-1 flex overflow-hidden">
              {/* LEFT: Issue Details */}
              <div className="w-1/2 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-6">
                <div className="mb-4">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    #{currentIssue.issue_number}: {currentIssue.title}
                  </h3>
                  <div className="flex gap-2 text-sm text-gray-500">
                    <span>State: {currentIssue.state}</span>
                    <span>•</span>
                    <span>Created: {new Date(currentIssue.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Issue body with truncation */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-white">Description</h4>
                  <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
                    {currentIssue.body
                      ? (issueBodyExpanded
                          ? currentIssue.body
                          : currentIssue.body.substring(0, 500) + (currentIssue.body.length > 500 ? '...' : ''))
                      : 'No description provided'}
                  </pre>
                  {currentIssue.body && currentIssue.body.length > 500 && (
                    <button
                      onClick={() => setIssueBodyExpanded(!issueBodyExpanded)}
                      className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                    >
                      {issueBodyExpanded ? 'Show Less' : 'Show More'}
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT: Analysis */}
              <div className="w-1/2 overflow-y-auto p-6">
                {!analysis ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="text-center mb-6">
                      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        Ready to analyze?
                      </h3>
                      <p className="text-gray-500 text-sm">
                        Click below to run AI analysis on this issue
                      </p>
                    </div>
                    <button
                      onClick={handleAnalyzeClick}
                      disabled={analyzing}
                      className="bg-blue-600 text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {analyzing ? (
                        <span className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          Analyzing...
                        </span>
                      ) : (
                        '🔍 Analyze with AI'
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Category & Confidence */}
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Analysis Results</h3>
                      <div className="flex items-center gap-3 mb-2">
                        <CategoryBadge category={analysis.primary_category} />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {Math.round((analysis.confidence || 0) * 100)}% confident
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.reasoning}</p>
                    </div>

                    {/* Related Info (compact) */}
                    {(analysis.duplicate_of || analysis.related_prs?.length > 0) && (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                        <h4 className="font-semibold text-sm mb-2 text-gray-900 dark:text-white">Related</h4>
                        {analysis.duplicate_of && (
                          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                            <span className="font-medium">Duplicate of:</span>{' '}
                            <span className="text-blue-600 dark:text-blue-400">#{analysis.duplicate_of}</span>
                          </div>
                        )}
                        {analysis.related_prs?.length > 0 && (
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium">Related PRs:</span>{' '}
                            {analysis.related_prs.map((pr, i) => (
                              <span key={pr}>
                                <span className="text-blue-600 dark:text-blue-400">#{pr}</span>
                                {i < analysis.related_prs.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested Responses */}
                    {analysis.suggested_responses?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Suggested Responses</h4>
                        <div className="space-y-3">
                          {analysis.suggested_responses.map((response, index) => (
                            <div key={index} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                              <div className="flex justify-between items-start mb-2">
                                <span className="font-medium text-sm text-gray-900 dark:text-white">{response.title}</span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => copyResponse(index)}
                                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                                  >
                                    {copiedResponse === index ? (
                                      <>✓ Copied</>
                                    ) : (
                                      <><kbd className="kbd">{index + 1}</kbd> Copy</>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => postResponseToGitHub(index)}
                                    disabled={postingResponse === index}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {postingResponse === index ? (
                                      'Posting...'
                                    ) : postedResponse === index ? (
                                      '✓ Posted!'
                                    ) : (
                                      'Post to GitHub'
                                    )}
                                  </button>
                                </div>
                              </div>
                              <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-sans">
                                {response.body}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer: Navigation & Shortcuts */}
            <div className="bg-gray-50 dark:bg-gray-800 px-6 py-4 flex justify-between items-center rounded-b-xl border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400">
                <span><kbd className="kbd">J</kbd> / <kbd className="kbd">K</kbd> Next/Prev</span>
                <span><kbd className="kbd">1</kbd><kbd className="kbd">2</kbd><kbd className="kbd">3</kbd> Copy</span>
                <span><kbd className="kbd">Esc</kbd> Exit</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={previousIssue}
                  disabled={currentIndex === 0}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={nextIssue}
                  disabled={currentIndex === issues.length - 1}
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
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

'use client'

import { useState, useEffect, useRef } from 'react'
import { API_ENDPOINTS } from '@/lib/config'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

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
  // New optimized format
  decision?: 'CLOSE_DUPLICATE' | 'CLOSE_FIXED' | 'CLOSE_EXISTS' | 'NEEDS_INVESTIGATION' |
             'VALID_FEATURE' | 'NEEDS_INFO' | 'ANSWER_FROM_DOCS' | 'INVALID'
  primary_message?: string
  evidence_bullets?: string[]
  draft_response?: string
  action_button_text?: string
  action_button_style?: 'danger' | 'success' | 'primary' | 'warning'
  related_links?: Array<{
    text: string
    url: string
    source: 'stackoverflow' | 'github' | 'docs' | 'internal'
  }>
  // Old format (for backwards compatibility)
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
  api_cost?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cached_tokens?: number
    input_cost_usd: number
    output_cost_usd: number
    total_cost_usd: number
  }
  from_cache?: boolean
  cost_saved?: number
  rule_matched?: string
}

interface TriageModeModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  initialIssueNumber?: number | null
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

// Decision card configuration
const DECISION_CONFIG: Record<string, { icon: string; color: string; bgColor: string; borderColor: string }> = {
  CLOSE_DUPLICATE: { icon: '🔴', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-900/20', borderColor: 'border-red-200 dark:border-red-800' },
  CLOSE_FIXED: { icon: '🟢', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-50 dark:bg-green-900/20', borderColor: 'border-green-200 dark:border-green-800' },
  CLOSE_EXISTS: { icon: '🔵', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-50 dark:bg-blue-900/20', borderColor: 'border-blue-200 dark:border-blue-800' },
  NEEDS_INVESTIGATION: { icon: '⚠️', color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-50 dark:bg-orange-900/20', borderColor: 'border-orange-200 dark:border-orange-800' },
  VALID_FEATURE: { icon: '💡', color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-50 dark:bg-purple-900/20', borderColor: 'border-purple-200 dark:border-purple-800' },
  NEEDS_INFO: { icon: '❓', color: 'text-yellow-700 dark:text-yellow-300', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20', borderColor: 'border-yellow-200 dark:border-yellow-800' },
  ANSWER_FROM_DOCS: { icon: '📚', color: 'text-teal-700 dark:text-teal-300', bgColor: 'bg-teal-50 dark:bg-teal-900/20', borderColor: 'border-teal-200 dark:border-teal-800' },
  INVALID: { icon: '🚫', color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-50 dark:bg-gray-800', borderColor: 'border-gray-200 dark:border-gray-700' }
}

const BUTTON_STYLES: Record<string, string> = {
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  warning: 'bg-orange-600 hover:bg-orange-700 text-white'
}

export default function TriageModeModal({ projectId, isOpen, onClose, initialIssueNumber }: TriageModeModalProps) {
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
  const [analysisProgress, setAnalysisProgress] = useState<{
    similarIssues: boolean
    codeSearch: boolean
    internetSearch: boolean
    aiAnalysis: boolean
  }>({ similarIssues: false, codeSearch: false, internetSearch: false, aiAnalysis: false })
  const [showDetails, setShowDetails] = useState(false)

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
    if (!isOpen) return

    const controller = new AbortController()

    loadUncategorizedIssues()
    setAnalyzedIssues(new Map()) // Clear cache on open

    return () => {
      controller.abort() // Cancel any pending requests on unmount
    }
  }, [isOpen, projectId])

  // Set current index to initialIssueNumber if provided
  useEffect(() => {
    if (isOpen && initialIssueNumber && issues.length > 0) {
      const index = issues.findIndex(
        issue => issue.issue_number === initialIssueNumber
      )
      if (index !== -1) {
        setCurrentIndex(index)
      }
    }
  }, [isOpen, initialIssueNumber, issues])

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

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(API_ENDPOINTS.triageUncategorized(projectId), {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error('Failed to load issues')
      }

      const data = await res.json()
      setIssues(data)
      setCurrentIndex(0)
      setAnalysis(null)
    } catch (err: any) {
      if (err.name === 'AbortError') return // Ignore aborted requests
      console.error('Failed to load uncategorized issues:', err)
      alert(`Failed to load issues: ${err.message || 'Unknown error'}`)
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
                  <h4 className="font-semibold mb-2 text-gray-900 dark:text-white text-sm">Description</h4>
                  <div className="text-sm text-gray-700 dark:text-gray-300 break-words overflow-x-auto">
                    <ReactMarkdown
                      components={{
                        p: ({ node, children, ...props }) => {
                          // Convert plain URLs to clickable links
                          const urlRegex = /(https?:\/\/[^\s]+)/g;
                          const processedChildren = typeof children === 'string'
                            ? children.split(urlRegex).map((part, i) =>
                                urlRegex.test(part) ? (
                                  <a key={i} href={part} className="text-blue-600 dark:text-blue-400 hover:underline break-all" target="_blank" rel="noopener noreferrer">
                                    {part}
                                  </a>
                                ) : part
                              )
                            : children;
                          return <p className="my-2 text-sm leading-relaxed" {...props}>{processedChildren}</p>;
                        },
                        a: ({ node, ...props }) => (
                          <a {...props} className="text-blue-600 dark:text-blue-400 hover:underline break-all" target="_blank" rel="noopener noreferrer" />
                        ),
                        code: ({ node, inline, className, children, ...props }: any) => {
                          const match = /language-(\w+)/.exec(className || '')
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              className="rounded-md my-2 text-xs overflow-x-auto"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs font-mono break-all" {...props}>
                              {children}
                            </code>
                          )
                        },
                        pre: ({ node, ...props }) => (
                          <pre className="bg-gray-200 dark:bg-gray-700 p-2 rounded-md overflow-x-auto text-xs my-2" {...props} />
                        ),
                        img: ({ node, ...props }) => (
                          <img {...props} className="max-w-full h-auto rounded-md my-2" alt={props.alt || ''} />
                        ),
                        h1: ({ node, ...props }) => <h1 className="text-base font-bold mt-3 mb-1.5 text-gray-900 dark:text-white" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="text-sm font-bold mt-2.5 mb-1.5 text-gray-900 dark:text-white" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-900 dark:text-white" {...props} />,
                        h4: ({ node, ...props }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-gray-900 dark:text-white" {...props} />,
                        h5: ({ node, ...props }) => <h5 className="text-sm font-medium mt-1.5 mb-1 text-gray-900 dark:text-white" {...props} />,
                        h6: ({ node, ...props }) => <h6 className="text-sm font-medium mt-1.5 mb-1 text-gray-900 dark:text-white" {...props} />,
                        ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-2 text-sm" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-2 text-sm" {...props} />,
                        li: ({ node, ...props }) => <li className="my-0.5 text-sm" {...props} />,
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 italic my-2 text-sm" {...props} />
                        ),
                      }}
                    >
                      {currentIssue.body
                        ? (issueBodyExpanded
                            ? currentIssue.body
                            : currentIssue.body.substring(0, 500) + (currentIssue.body.length > 500 ? '...' : ''))
                        : 'No description provided'}
                    </ReactMarkdown>
                  </div>
                  {currentIssue.body && currentIssue.body.length > 500 && (
                    <button
                      onClick={() => setIssueBodyExpanded(!issueBodyExpanded)}
                      className="mt-2 text-blue-600 hover:text-blue-700 text-xs font-medium"
                    >
                      {issueBodyExpanded ? 'Show Less' : 'Show More'}
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT: Analysis */}
              <div className="w-1/2 overflow-y-auto p-6">
                {!analysis ? (
                  <div className="flex flex-col items-center justify-center h-full px-8">
                    <div className="text-center mb-8 max-w-md">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
                        <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        Ready to analyze?
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed mb-4">
                        AI will analyze this issue and provide:
                      </p>
                      <div className="text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
                        <ul className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                          <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                            <span><strong>Smart categorization</strong> (bug, feature, critical, etc.)</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                            <span><strong>Duplicate detection</strong> across existing issues</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                            <span><strong>Related PRs</strong> that might address this</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                            <span><strong>Documentation links</strong> from your codebase</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 mt-0.5">✓</span>
                            <span><strong>Suggested responses</strong> ready to post</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                    <button
                      onClick={handleAnalyzeClick}
                      disabled={analyzing}
                      className="group relative bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-3.5 rounded-lg font-semibold text-base shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100"
                    >
                      {analyzing ? (
                        <span className="flex items-center gap-3">
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                          <span>Analyzing with AI...</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>Analyze with AI</span>
                        </span>
                      )}
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-4">
                      Powered by Claude Sonnet 4.5 • Usually takes 2-5 seconds
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Decision Card (New Format) or Category Badge (Old Format) */}
                    {analysis.decision ? (
                      // NEW FORMAT: Show enhanced decision card
                      <div className={`${DECISION_CONFIG[analysis.decision]?.bgColor} ${DECISION_CONFIG[analysis.decision]?.borderColor} border-2 rounded-lg p-5`}>
                        <div className="flex items-start gap-4">
                          <div className="text-4xl">{DECISION_CONFIG[analysis.decision]?.icon}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <h3 className={`text-lg font-bold ${DECISION_CONFIG[analysis.decision]?.color}`}>
                                {analysis.decision.replace(/_/g, ' ')}
                              </h3>
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {Math.round((analysis.confidence || 0) * 100)}% confident
                              </span>
                              {analysis.api_cost && (
                                <span className="text-xs px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded font-mono">
                                  ${analysis.api_cost.total_cost_usd.toFixed(4)}
                                </span>
                              )}
                            </div>
                            <p className="text-base font-semibold text-gray-900 dark:text-white mb-3">
                              {analysis.primary_message}
                            </p>
                            {analysis.evidence_bullets && analysis.evidence_bullets.length > 0 && (
                              <ul className="space-y-1.5">
                                {analysis.evidence_bullets.map((bullet, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                                    <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      // OLD FORMAT: Show category badge (backwards compatibility)
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Analysis Results</h3>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <CategoryBadge category={analysis.primary_category} />
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {Math.round((analysis.confidence || 0) * 100)}% confident
                          </span>
                          {analysis.api_cost && (
                            <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded font-mono">
                              Cost: ${analysis.api_cost.total_cost_usd.toFixed(4)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.reasoning}</p>
                      </div>
                    )}

                    {/* Related Links (New Format) */}
                    {analysis.related_links && analysis.related_links.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                        <h4 className="font-semibold text-sm mb-3 text-gray-900 dark:text-white">Related Resources</h4>
                        <div className="space-y-2">
                          {analysis.related_links.map((link, i) => {
                            const sourceIcons = {
                              stackoverflow: '🔎',
                              github: '🐙',
                              docs: '📚',
                              internal: '🔗'
                            }
                            return (
                              <a
                                key={i}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <span>{sourceIcons[link.source] || '🔗'}</span>
                                <span>{link.text}</span>
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}

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
                              <span key={`pr-${pr}`}>
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
                            <div key={`response-${analysis.issue_number}-${index}-${response.type}`} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
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
                              <div className="text-xs text-gray-600 dark:text-gray-400 break-words overflow-x-auto">
                                <ReactMarkdown
                                  components={{
                                    p: ({ node, children, ...props }) => {
                                      // Convert plain URLs to clickable links
                                      const urlRegex = /(https?:\/\/[^\s]+)/g;
                                      const processedChildren = typeof children === 'string'
                                        ? children.split(urlRegex).map((part, i) =>
                                            urlRegex.test(part) ? (
                                              <a key={i} href={part} className="text-blue-600 dark:text-blue-400 hover:underline break-all" target="_blank" rel="noopener noreferrer">
                                                {part}
                                              </a>
                                            ) : part
                                          )
                                        : children;
                                      return <p className="my-1 text-xs leading-relaxed" {...props}>{processedChildren}</p>;
                                    },
                                    a: ({ node, ...props }) => (
                                      <a {...props} className="text-blue-600 dark:text-blue-400 hover:underline break-all" target="_blank" rel="noopener noreferrer" />
                                    ),
                                    code: ({ node, inline, className, children, ...props }: any) => {
                                      const match = /language-(\w+)/.exec(className || '')
                                      return !inline && match ? (
                                        <SyntaxHighlighter
                                          style={vscDarkPlus}
                                          language={match[1]}
                                          PreTag="div"
                                          className="rounded-md my-1.5 text-xs overflow-x-auto"
                                          {...props}
                                        >
                                          {String(children).replace(/\n$/, '')}
                                        </SyntaxHighlighter>
                                      ) : (
                                        <code className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-xs font-mono break-all" {...props}>
                                          {children}
                                        </code>
                                      )
                                    },
                                    pre: ({ node, ...props }) => (
                                      <pre className="bg-gray-200 dark:bg-gray-700 p-2 rounded-md overflow-x-auto text-xs my-1.5" {...props} />
                                    ),
                                    img: ({ node, ...props }) => (
                                      <img {...props} className="max-w-full h-auto rounded-md my-1.5" alt={props.alt || ''} />
                                    ),
                                    h1: ({ node, ...props }) => <h1 className="text-sm font-bold mt-2 mb-1 text-gray-900 dark:text-white" {...props} />,
                                    h2: ({ node, ...props }) => <h2 className="text-xs font-bold mt-2 mb-1 text-gray-900 dark:text-white" {...props} />,
                                    h3: ({ node, ...props }) => <h3 className="text-xs font-semibold mt-1.5 mb-0.5 text-gray-900 dark:text-white" {...props} />,
                                    h4: ({ node, ...props }) => <h4 className="text-xs font-semibold mt-1.5 mb-0.5 text-gray-900 dark:text-white" {...props} />,
                                    h5: ({ node, ...props }) => <h5 className="text-xs font-medium mt-1 mb-0.5 text-gray-900 dark:text-white" {...props} />,
                                    h6: ({ node, ...props }) => <h6 className="text-xs font-medium mt-1 mb-0.5 text-gray-900 dark:text-white" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc pl-4 my-1.5 text-xs" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-4 my-1.5 text-xs" {...props} />,
                                    li: ({ node, ...props }) => <li className="my-0.5 text-xs" {...props} />,
                                    blockquote: ({ node, ...props }) => (
                                      <blockquote className="border-l-3 border-gray-300 dark:border-gray-600 pl-2 italic my-1.5 text-xs" {...props} />
                                    ),
                                  }}
                                >
                                  {response.body}
                                </ReactMarkdown>
                              </div>
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

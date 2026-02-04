'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Flame, Bug, Lightbulb, HelpCircle, Trash2, PartyPopper,
  XCircle, CheckCircle, Info, AlertTriangle, Ban, BookOpen, Check,
  Search, Github, Link, ExternalLink
} from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/config'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeRewrite from 'rehype-rewrite'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Issue {
  issue_number: number
  title: string
  body: string
  state: string
  created_at: string
  author?: string
  html_url?: string
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
  critical: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', label: 'Critical' },
  bug: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300', label: 'Bug' },
  feature_request: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', label: 'Feature Request' },
  question: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: 'Question' },
  low_priority: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-300', label: 'Low Priority' }
}

function CategoryBadge({ category }: { category: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    critical: <Flame className="w-3 h-3" />,
    bug: <Bug className="w-3 h-3" />,
    feature_request: <Lightbulb className="w-3 h-3" />,
    question: <HelpCircle className="w-3 h-3" />,
    low_priority: <Trash2 className="w-3 h-3" />
  }

  const colors = CATEGORY_COLORS[category] || { bg: 'bg-gray-100', text: 'text-gray-800', label: category }
  const icon = iconMap[category]

  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${colors.bg} ${colors.text}`}>
      {icon}
      {colors.label}
    </span>
  )
}

// Decision card configuration
const DECISION_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; borderColor: string }> = {
  CLOSE_DUPLICATE: { icon: <XCircle className="w-10 h-10" />, color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-50 dark:bg-red-900/20', borderColor: 'border-red-200 dark:border-red-800' },
  CLOSE_FIXED: { icon: <CheckCircle className="w-10 h-10" />, color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-50 dark:bg-green-900/20', borderColor: 'border-green-200 dark:border-green-800' },
  CLOSE_EXISTS: { icon: <Info className="w-10 h-10" />, color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-50 dark:bg-blue-900/20', borderColor: 'border-blue-200 dark:border-blue-800' },
  NEEDS_INVESTIGATION: { icon: <AlertTriangle className="w-10 h-10" />, color: 'text-orange-700 dark:text-orange-300', bgColor: 'bg-orange-50 dark:bg-orange-900/20', borderColor: 'border-orange-200 dark:border-orange-800' },
  VALID_FEATURE: { icon: <Lightbulb className="w-10 h-10" />, color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-50 dark:bg-purple-900/20', borderColor: 'border-purple-200 dark:border-purple-800' },
  NEEDS_INFO: { icon: <HelpCircle className="w-10 h-10" />, color: 'text-yellow-700 dark:text-yellow-300', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20', borderColor: 'border-yellow-200 dark:border-yellow-800' },
  ANSWER_FROM_DOCS: { icon: <BookOpen className="w-10 h-10" />, color: 'text-teal-700 dark:text-teal-300', bgColor: 'bg-teal-50 dark:bg-teal-900/20', borderColor: 'border-teal-200 dark:border-teal-800' },
  INVALID: { icon: <Ban className="w-10 h-10" />, color: 'text-gray-700 dark:text-gray-300', bgColor: 'bg-gray-50 dark:bg-gray-800', borderColor: 'border-gray-200 dark:border-gray-700' }
}

const BUTTON_STYLES: Record<string, string> = {
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  warning: 'bg-orange-600 hover:bg-orange-700 text-white'
}

// Helper function to fix GitHub image URLs
function fixGitHubImageUrl(url: string): string {
  if (!url) return url;

  // If it's a relative URL, convert to absolute GitHub URL
  if (url.startsWith('/')) {
    // This shouldn't happen often, but handle it just in case
    return `https://github.com${url}`;
  }

  // GitHub camo proxy URLs are fine
  if (url.includes('camo.githubusercontent.com') ||
      url.includes('user-images.githubusercontent.com') ||
      url.includes('github.com/user-attachments')) {
    return url;
  }

  return url;
}

export default function TriageModeModal({ projectId, isOpen, onClose, initialIssueNumber }: TriageModeModalProps) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [analysis, setAnalysis] = useState<TriageAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false) // For checking if analysis exists
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

  // Load uncategorized issues OR specific issue if initialIssueNumber provided
  useEffect(() => {
    if (!isOpen) return

    const controller = new AbortController()

    async function loadIssues() {
      setAnalyzedIssues(new Map()) // Clear cache on open

      // ALWAYS load ALL uncategorized issues (search is just a UI filter)
      // Even if initialIssueNumber is provided, load the full list
      await loadIssuesWithTriage()
      setLoadingAnalysis(false) // Done loading
    }

    loadIssues()

    return () => {
      controller.abort()
    }
  }, [isOpen, projectId, initialIssueNumber])

  // Set current index to initialIssueNumber if it's in the uncategorized list
  useEffect(() => {
    if (!isOpen || !initialIssueNumber || issues.length === 0) return

    const index = issues.findIndex(
      issue => issue.issue_number === initialIssueNumber
    )

    if (index !== -1) {
      setCurrentIndex(index)
    } else if (issues.length > 0) {
      // Not found, default to first issue
      setCurrentIndex(0)
    }
  }, [isOpen, initialIssueNumber, issues])

  // Load saved analysis when currentIndex changes
  useEffect(() => {
    if (!isOpen || !issues[currentIndex]) return

    const issueNumber = issues[currentIndex].issue_number

    // Check if already in cache
    if (analyzedIssues.has(issueNumber)) {
      setAnalysis(analyzedIssues.get(issueNumber)!)
      setLoadingAnalysis(false)
      return
    }

    // Clear current analysis and show loader
    setAnalysis(null)
    setLoadingAnalysis(true)

    // Try to load saved analysis from database
    loadSavedAnalysis(issueNumber).finally(() => {
      setLoadingAnalysis(false)
    })
  }, [isOpen, currentIndex, issues])

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
            setCurrentIndex(index + 1)
            setIssueBodyExpanded(false)
            // Analysis will be loaded by useEffect
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (index > 0) {
            setCurrentIndex(index - 1)
            setIssueBodyExpanded(false)
            // Analysis will be loaded by useEffect
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

  async function loadIssuesWithTriage() {
    try {
      setLoading(true)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      // Use new endpoint that returns issues with their triage responses
      const res = await fetch(API_ENDPOINTS.triageIssuesWithTriage(projectId, 'open'), {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error('Failed to load issues')
      }

      const data = await res.json()

      // data.issues is array of {issue: {...}, triage: {...} or null}
      // Transform to match current structure and pre-load triage responses
      const issuesArray = data.issues.map((item: any) => item.issue)
      setIssues(issuesArray)

      // Pre-populate analyzedIssues cache with existing triage responses
      const triageCache = new Map()
      data.issues.forEach((item: any) => {
        if (item.triage) {
          triageCache.set(item.issue.issue_number, item.triage)
        }
      })
      setAnalyzedIssues(triageCache)

      setCurrentIndex(0)

      // Load triage for first issue if it exists
      const firstIssue = data.issues[0]
      if (firstIssue && firstIssue.triage) {
        setAnalysis(firstIssue.triage)
      } else {
        setAnalysis(null)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return // Ignore aborted requests
      console.error('Failed to load issues:', err)
      alert(`Failed to load issues: ${err.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  // Load saved analysis from database
  async function loadSavedAnalysis(issueNumber: number) {
    try {
      const res = await fetch(API_ENDPOINTS.triageIssue(projectId, issueNumber))

      if (res.ok) {
        const data = await res.json()
        // Cache and set the saved analysis
        setAnalyzedIssues(prev => new Map(prev).set(issueNumber, data))
        setAnalysis(data)
        return true
      }
    } catch (err) {
      // No saved analysis found, that's okay
      console.debug('No saved analysis found for issue', issueNumber)
    }
    return false
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
      setCurrentIndex(currentIndex + 1)
      setIssueBodyExpanded(false)
      // Analysis will be loaded by useEffect
    }
  }

  function previousIssue() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setIssueBodyExpanded(false)
      // Analysis will be loaded by useEffect
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
      <div className="bg-white dark:bg-neutral-900 w-[95%] h-[95%] rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="bg-neutral-100 dark:bg-neutral-800 px-6 py-4 flex justify-between items-center rounded-t-lg border-b border-neutral-200 dark:border-neutral-700">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Triage</h2>
          <div className="flex items-center gap-4">
            {issues.length > 0 && (
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                {currentIndex + 1} of {issues.length}
              </span>
            )}
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-neutral-300 dark:border-neutral-700 mx-auto mb-4"></div>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm">Loading issues…</p>
            </div>
          </div>
        ) : issues.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <Check className="w-6 h-6 text-neutral-600 dark:text-neutral-400" />
              </div>
              <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                All caught up
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
                No issues to triage.
              </p>
              <button
                onClick={onClose}
                className="bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-6 py-2 rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Two-column layout */}
            <div className="flex-1 flex overflow-hidden">
              {/* LEFT: Issue Details */}
              <div className="w-1/2 border-r border-neutral-200 dark:border-neutral-700 overflow-y-auto p-6">
                <div className="mb-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex-1">
                      #{currentIssue.issue_number}: {currentIssue.title}
                    </h3>
                    <button
                      onClick={() => window.open(currentIssue.html_url, '_blank')}
                      className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors flex-shrink-0"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                    <span>{currentIssue.state}</span>
                    {currentIssue.author && (
                      <>
                        <span>•</span>
                        <span>by {currentIssue.author}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>{new Date(currentIssue.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Issue body with truncation */}
                <div className="bg-neutral-50 dark:bg-neutral-850 rounded-lg p-4 border border-neutral-200 dark:border-neutral-700">
                  <div className="text-sm text-gray-700 dark:text-gray-300 break-words overflow-x-auto">
                    <ReactMarkdown
                      rehypePlugins={[
                        rehypeRaw,
                        rehypeSanitize,
                        [rehypeRewrite, {
                          rewrite: (node: any) => {
                            if (node.type === 'element' && node.tagName === 'img') {
                              node.properties = {
                                ...node.properties,
                                loading: 'lazy',
                                className: 'max-w-full h-auto rounded-md my-2',
                                style: 'display: block;'
                              }
                            }
                          }
                        }]
                      ]}
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
                        img: ({ node, ...props }) => {
                          // Check if it's a video
                          const src = (typeof props.src === 'string' ? props.src : '') || '';
                          const fixedSrc = fixGitHubImageUrl(src);
                          const isVideo = src.match(/\.(mp4|webm|ogg|mov)$/i) || (src.includes('user-attachments') && src.includes('.mov'));

                          if (isVideo) {
                            return (
                              <video
                                controls
                                className="max-w-full h-auto rounded-md my-2"
                                src={fixedSrc}
                              >
                                Your browser does not support the video tag.
                              </video>
                            );
                          }

                          return (
                            <img
                              {...props}
                              src={fixedSrc}
                              className="max-w-full h-auto rounded-md my-2"
                              alt={props.alt || 'Image'}
                              loading="lazy"
                              style={{ display: 'block' }}
                            />
                          );
                        },
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
                      className="mt-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 text-xs font-medium"
                    >
                      {issueBodyExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT: Analysis */}
              <div className="w-1/2 overflow-y-auto p-6">
                {loadingAnalysis ? (
                  /* Loading state while checking for analysis */
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-12 w-12 border-2 border-neutral-200 dark:border-neutral-700 border-t-neutral-500 mb-4"></div>
                    <p className="text-neutral-500 dark:text-neutral-400 text-sm">Loading…</p>
                  </div>
                ) : !analysis ? (
                  <div className="flex flex-col items-center justify-center h-full px-8">
                    <div className="text-center mb-8 max-w-md">
                      <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-3">
                        Analyze this issue
                      </h3>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed mb-6">
                        Searches similar issues, related code, and documentation to draft a response. Nothing is posted automatically.
                      </p>
                    </div>
                    <button
                      onClick={handleAnalyzeClick}
                      disabled={analyzing}
                      className={`px-6 py-2.5 rounded-md font-medium text-base transition-colors ${
                        analyzing
                          ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 cursor-not-allowed'
                          : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200'
                      }`}
                    >
                      {analyzing ? (
                        <span className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-neutral-500 border-t-transparent"></div>
                          <span>Analyzing…</span>
                        </span>
                      ) : (
                        <span>Analyze issue</span>
                      )}
                    </button>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-3">
                      Takes 5–10 seconds
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Decision Card (New Format) or Category Badge (Old Format) */}
                    {analysis.decision ? (
                      // NEW FORMAT: Show enhanced decision card
                      <div className="bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg p-5">
                        <div className="flex items-start gap-4">
                          <div className="text-neutral-600 dark:text-neutral-400">
                            {DECISION_CONFIG[analysis.decision]?.icon}
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                              {analysis.decision.replace(/_/g, ' ')}
                            </h3>
                            <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-3">
                              {analysis.primary_message}
                            </p>
                            {analysis.evidence_bullets && analysis.evidence_bullets.length > 0 && (
                              <ul className="space-y-1.5">
                                {analysis.evidence_bullets.map((bullet, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                                    <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-400 flex-shrink-0"></span>
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
                      <div className="bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg p-5">
                        <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                          {analysis.primary_category.replace(/_/g, ' ')}
                        </h3>
                        <p className="text-sm text-neutral-700 dark:text-neutral-300">{analysis.reasoning}</p>
                      </div>
                    )}

                    {/* Related Links (New Format) */}
                    {analysis.related_links && analysis.related_links.length > 0 && (
                      <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
                        <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Related</h4>
                        <div className="space-y-1.5">
                          {analysis.related_links.map((link, i) => (
                            <a
                              key={i}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
                            >
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                              <span>{link.text}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Info (compact) */}
                    {(analysis.duplicate_of || analysis.related_prs?.length > 0) && (
                      <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
                        <h4 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">References</h4>
                        {analysis.duplicate_of && (
                          <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">
                            Duplicate of #{analysis.duplicate_of}
                          </div>
                        )}
                        {analysis.related_prs?.length > 0 && (
                          <div className="text-sm text-neutral-600 dark:text-neutral-400">
                            Related PRs: {analysis.related_prs.map((pr, i) => (
                              <span key={`pr-${pr}`}>
                                #{pr}{i < analysis.related_prs.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested Responses */}
                    {analysis.suggested_responses?.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-base font-medium text-neutral-900 dark:text-neutral-100">Draft response</h4>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">Review before posting</span>
                        </div>
                        <div className="space-y-3">
                          {analysis.suggested_responses.map((response, index) => (
                            <div key={`response-${analysis.issue_number}-${index}-${response.type}`} className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4">
                              <div className="flex justify-between items-start mb-3">
                                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{response.title}</span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => copyResponse(index)}
                                    className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 font-medium"
                                  >
                                    {copiedResponse === index ? 'Copied' : 'Copy'}
                                  </button>
                                  <button
                                    onClick={() => postResponseToGitHub(index)}
                                    disabled={postingResponse === index}
                                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                      postingResponse === index || postedResponse === index
                                        ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 cursor-not-allowed'
                                        : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200'
                                    }`}
                                  >
                                    {postingResponse === index ? (
                                      'Posting…'
                                    ) : postedResponse === index ? (
                                      'Posted'
                                    ) : (
                                      'Post'
                                    )}
                                  </button>
                                </div>
                              </div>
                              <div className="text-sm text-neutral-700 dark:text-neutral-300 break-words overflow-x-auto">
                                <ReactMarkdown
                                  rehypePlugins={[
                                    rehypeRaw,
                                    rehypeSanitize,
                                    [rehypeRewrite, {
                                      rewrite: (node: any) => {
                                        if (node.type === 'element' && node.tagName === 'img') {
                                          node.properties = {
                                            ...node.properties,
                                            loading: 'lazy',
                                            className: 'max-w-full h-auto rounded-md my-1.5',
                                            style: 'display: block;'
                                          }
                                        }
                                      }
                                    }]
                                  ]}
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
                                    img: ({ node, ...props }) => {
                                      // Check if it's a video
                                      const src = (typeof props.src === 'string' ? props.src : '') || '';
                                      const fixedSrc = fixGitHubImageUrl(src);
                                      const isVideo = src.match(/\.(mp4|webm|ogg|mov)$/i) || (src.includes('user-attachments') && src.includes('.mov'));

                                      if (isVideo) {
                                        return (
                                          <video
                                            controls
                                            className="max-w-full h-auto rounded-md my-1.5"
                                            src={fixedSrc}
                                          >
                                            Your browser does not support the video tag.
                                          </video>
                                        );
                                      }

                                      return (
                                        <img
                                          {...props}
                                          src={fixedSrc}
                                          className="max-w-full h-auto rounded-md my-1.5"
                                          alt={props.alt || 'Image'}
                                          loading="lazy"
                                          style={{ display: 'block' }}
                                        />
                                      );
                                    },
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
            <div className="bg-neutral-50 dark:bg-neutral-800 px-6 py-3 flex justify-between items-center rounded-b-lg border-t border-neutral-200 dark:border-neutral-700">
              <div className="flex gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                <span><kbd className="kbd">Esc</kbd> Close</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={previousIssue}
                  disabled={currentIndex === 0}
                  className="px-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded text-xs font-medium disabled:opacity-30 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors disabled:cursor-not-allowed text-neutral-900 dark:text-neutral-100"
                >
                  Previous
                </button>
                <button
                  onClick={nextIssue}
                  disabled={currentIndex === issues.length - 1}
                  className="px-3 py-1.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded text-xs font-medium disabled:opacity-30 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:cursor-not-allowed"
                >
                  Next
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

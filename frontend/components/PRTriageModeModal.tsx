'use client'

import { useState, useEffect, useRef } from 'react'
import { API_ENDPOINTS } from '@/lib/config'
import { ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface PullRequest {
  number: number
  title: string
  body: string
  state: string
  created_at: string
  author: string
  labels: string[]
  html_url: string
  additions?: number
  deletions?: number
  changed_files?: number
}

interface PRTriageModeModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  initialPRNumber?: number | null
}

export default function PRTriageModeModal({ projectId, isOpen, onClose, initialPRNumber }: PRTriageModeModalProps) {
  const [prs, setPrs] = useState<PullRequest[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [prBodyExpanded, setPrBodyExpanded] = useState(false)

  // Refs for keyboard handler (to avoid stale closures)
  const currentIndexRef = useRef(currentIndex)
  const prsRef = useRef(prs)

  // Keep refs in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    prsRef.current = prs
  }, [prs])

  // Load all PRs
  useEffect(() => {
    if (!isOpen) return

    const controller = new AbortController()

    loadAllPRs()

    return () => {
      controller.abort()
    }
  }, [isOpen, projectId])

  // Set current index to initialPRNumber if provided
  useEffect(() => {
    if (isOpen && initialPRNumber && prs.length > 0) {
      const index = prs.findIndex(
        pr => pr.number === initialPRNumber
      )
      if (index !== -1) {
        setCurrentIndex(index)
      }
    }
  }, [isOpen, initialPRNumber, prs])

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    function handleKeyPress(e: KeyboardEvent) {
      // Ignore if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return
      }

      const index = currentIndexRef.current
      const prsList = prsRef.current

      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (index < prsList.length - 1) {
            setCurrentIndex(index + 1)
            setPrBodyExpanded(false)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (index > 0) {
            setCurrentIndex(index - 1)
            setPrBodyExpanded(false)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isOpen, onClose])

  async function loadAllPRs() {
    try {
      setLoading(true)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(API_ENDPOINTS.githubPRs(projectId), {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error('Failed to load pull requests')
      }

      const data = await res.json()

      // Sort by created_at descending (newest first)
      const sortedPRs = (data.pull_requests || []).sort((a: PullRequest, b: PullRequest) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      setPrs(sortedPRs)
      setCurrentIndex(0)
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('Failed to load pull requests:', err)
      alert(`Failed to load pull requests: ${err.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  function nextPR() {
    if (currentIndex < prs.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setPrBodyExpanded(false)
    }
  }

  function previousPR() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setPrBodyExpanded(false)
    }
  }

  function getStateColor(state: string) {
    if (state === 'open') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    if (state === 'merged') return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }

  if (!isOpen) return null

  const currentPR = prs[currentIndex]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 w-[95%] h-[95%] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gray-900 text-white px-6 py-4 flex justify-between items-center rounded-t-xl">
          <h2 className="text-xl font-bold">PR Review Mode</h2>
          <div className="flex items-center gap-4">
            {prs.length > 0 && (
              <span className="text-sm text-gray-400">
                PR {currentIndex + 1} of {prs.length}
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
              <p className="text-gray-600 dark:text-gray-400">Loading pull requests...</p>
            </div>
          </div>
        ) : prs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">📝</div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No pull requests found
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Sync from GitHub to import pull requests.
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
            {/* Single column layout for PR details */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                {/* PR Header */}
                <div className="mb-6">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                      #{currentPR.number}: {currentPR.title}
                    </h3>
                    <a
                      href={currentPR.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open on GitHub
                    </a>
                  </div>

                  <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 mb-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStateColor(currentPR.state)}`}>
                      {currentPR.state}
                    </span>
                    <span>by {currentPR.author}</span>
                    <span>•</span>
                    <span>Created: {new Date(currentPR.created_at).toLocaleDateString()}</span>
                  </div>

                  {/* Stats */}
                  {(currentPR.additions || currentPR.deletions || currentPR.changed_files) && (
                    <div className="flex gap-4 text-sm mb-4">
                      {currentPR.additions !== undefined && (
                        <span className="text-green-600 dark:text-green-400">
                          +{currentPR.additions} additions
                        </span>
                      )}
                      {currentPR.deletions !== undefined && (
                        <span className="text-red-600 dark:text-red-400">
                          -{currentPR.deletions} deletions
                        </span>
                      )}
                      {currentPR.changed_files !== undefined && (
                        <span className="text-gray-600 dark:text-gray-400">
                          {currentPR.changed_files} files changed
                        </span>
                      )}
                    </div>
                  )}

                  {/* Labels */}
                  {currentPR.labels && currentPR.labels.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {currentPR.labels.map((label, idx) => (
                        <span key={idx} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* PR Description */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
                  <h4 className="font-semibold mb-3 text-gray-900 dark:text-white text-sm">Description</h4>
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
                      {currentPR.body
                        ? (prBodyExpanded
                            ? currentPR.body
                            : currentPR.body.substring(0, 800) + (currentPR.body.length > 800 ? '...' : ''))
                        : 'No description provided'}
                    </ReactMarkdown>
                  </div>
                  {currentPR.body && currentPR.body.length > 800 && (
                    <button
                      onClick={() => setPrBodyExpanded(!prBodyExpanded)}
                      className="mt-3 text-blue-600 hover:text-blue-700 text-xs font-medium"
                    >
                      {prBodyExpanded ? 'Show Less' : 'Show More'}
                    </button>
                  )}
                </div>

                {/* Placeholder for future AI analysis */}
                <div className="mt-6 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
                    💡 AI Analysis Coming Soon
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    PR analysis features will include: code quality assessment, risk evaluation, review suggestions, and related issue detection.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer: Navigation & Shortcuts */}
            <div className="bg-gray-50 dark:bg-gray-800 px-6 py-4 flex justify-between items-center rounded-b-xl border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400">
                <span><kbd className="kbd">J</kbd> / <kbd className="kbd">K</kbd> Next/Prev</span>
                <span><kbd className="kbd">Esc</kbd> Exit</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={previousPR}
                  disabled={currentIndex === 0}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={nextPR}
                  disabled={currentIndex === prs.length - 1}
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

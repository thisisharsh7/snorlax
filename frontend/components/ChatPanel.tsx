'use client'

import { useState, useEffect, useRef } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactMarkdown from 'react-markdown'
import SettingsModal from './SettingsModal'
import { Search, MessageCircle, Lock, ChevronDown, ChevronUp } from 'lucide-react'

type QueryMode = 'search' | 'ai'

interface Source {
  filename: string
  code: string
  language: string
  start_line: number
  end_line: number
  similarity: number
}

interface Message {
  question: string
  answer: string | null
  sources: Source[]
  timestamp: Date
  mode: 'full' | 'search_only'
  has_llm_answer: boolean
  llm_error?: string
  loading?: boolean
  search_message?: string
}

interface ChatPanelProps {
  projectId: string
  repoName: string
}

function ModeToggle({
  mode,
  hasAIKey,
  onModeChange,
  onConfigureAI
}: {
  mode: QueryMode
  hasAIKey: boolean
  onModeChange: (mode: QueryMode) => void
  onConfigureAI: () => void
}) {
  function handleAIModeClick() {
    if (hasAIKey) {
      onModeChange('ai')
    } else {
      onConfigureAI()
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">Mode:</span>

      {/* Search Mode Button */}
      <button
        type="button"
        onClick={() => onModeChange('search')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
          mode === 'search'
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-500'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        <Search className="w-3.5 h-3.5" />
        <span>Search</span>
      </button>

      {/* AI Mode Button */}
      <button
        type="button"
        onClick={handleAIModeClick}
        disabled={!hasAIKey}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
          mode === 'ai' && hasAIKey
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-500'
            : !hasAIKey
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border border-transparent cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
        title={!hasAIKey ? 'Configure AI provider to enable AI mode' : 'AI-powered Q&A'}
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>AI Q&A</span>
        {!hasAIKey && <Lock className="w-3 h-3" />}
      </button>
    </div>
  )
}

export default function ChatPanel({ projectId, repoName }: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const [showAllSources, setShowAllSources] = useState<Map<number, boolean>>(new Map())
  const [showSourcesPanel, setShowSourcesPanel] = useState<Map<number, boolean>>(new Map())
  const [mode, setMode] = useState<QueryMode>('search')
  const [hasAIKey, setHasAIKey] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Check API key on mount
  useEffect(() => {
    checkAPIKey()
  }, [])

  // Reset state when switching repositories
  useEffect(() => {
    // Clear conversation and UI state
    setMessages([])
    setExpandedSources(new Set())
    setShowAllSources(new Map())
    setShowSourcesPanel(new Map())
    setQuestion('')
    setError('')
    setLoading(false)
  }, [projectId])

  async function checkAPIKey() {
    try {
      // Add cache-busting parameter to ensure fresh data
      const res = await fetch(`http://localhost:8000/api/settings?t=${Date.now()}`)
      const data = await res.json()
      const hasKey = data.anthropic_key_set || data.openai_key_set || data.openrouter_key_set
      setHasAIKey(hasKey)

      // If all keys deleted while in AI mode, switch to search
      if (!hasKey && mode === 'ai') {
        setMode('search')
      }

      // If key added, default to AI mode
      if (hasKey && mode === 'search') {
        setMode('ai')
      }
    } catch (e) {
      console.error('Failed to check API key:', e)
    }
  }

  function toggleSource(msgIdx: number, sourceIdx: number) {
    const key = `${msgIdx}-${sourceIdx}`

    // If "show all" mode is active, disable it
    if (showAllSources.get(msgIdx)) {
      setShowAllSources(new Map(showAllSources).set(msgIdx, false))
    }

    setExpandedSources(prev => {
      const next = new Set(prev)

      // Accordion behavior: Close all other sources in this message
      const messageSources = Array.from(next).filter(k => k.startsWith(`${msgIdx}-`))
      messageSources.forEach(k => next.delete(k))

      // Toggle the clicked source
      if (prev.has(key)) {
        // If it was open, keep it closed (already removed above)
      } else {
        next.add(key)  // Open the clicked source
      }

      return next
    })
  }

  function expandAllSources(msgIdx: number, sourceCount: number) {
    setShowAllSources(new Map(showAllSources).set(msgIdx, true))

    setExpandedSources(prev => {
      const next = new Set(prev)
      // Add all sources for this message
      for (let i = 0; i < sourceCount; i++) {
        next.add(`${msgIdx}-${i}`)
      }
      return next
    })
  }

  function collapseAllSources(msgIdx: number) {
    setShowAllSources(new Map(showAllSources).set(msgIdx, false))

    setExpandedSources(prev => {
      const next = new Set(prev)
      // Remove all sources for this message
      Array.from(next)
        .filter(key => key.startsWith(`${msgIdx}-`))
        .forEach(key => next.delete(key))
      return next
    })
  }

  function toggleSourcesPanel(msgIdx: number) {
    setShowSourcesPanel(prev => {
      const next = new Map(prev)
      next.set(msgIdx, !prev.get(msgIdx))
      return next
    })
  }

  async function handleQuery() {
    if (!question.trim()) return

    // Capture the question and clear input immediately
    const currentQuestion = question
    setQuestion('')
    setError('')

    // Add user message immediately with loading state
    const newMessage: Message = {
      question: currentQuestion,
      answer: null,
      sources: [],
      timestamp: new Date(),
      mode: 'full',
      has_llm_answer: false,
      loading: true
    }
    setMessages([...messages, newMessage])
    setLoading(true)

    try {
      const res = await fetch(`http://localhost:8000/api/query/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: currentQuestion, mode })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Query failed')
      }

      const data = await res.json()

      // Update the last message with the response
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          question: currentQuestion,
          answer: data.answer,
          sources: data.sources,
          timestamp: new Date(),
          mode: data.mode || 'full',
          has_llm_answer: data.has_llm_answer !== undefined ? data.has_llm_answer : true,
          llm_error: data.llm_error,
          search_message: data.search_message,
          loading: false
        }
        return updated
      })
    } catch (e: any) {
      setError(e.message)
      // Remove the loading message on error
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!loading && question.trim()) {
        handleQuery()
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 min-h-0">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
          {messages.map((msg, idx) => (
            <div key={idx} className="space-y-6">
              {/* User Question */}
              <div className="flex justify-end">
                <div className="bg-gray-900 dark:bg-gray-700 text-white rounded-2xl px-5 py-3 max-w-2xl">
                  <p className="text-sm">{msg.question}</p>
                </div>
              </div>

              {/* Response Container */}
              <div className="space-y-4">
                {/* Loading Indicator */}
                {msg.loading && (
                  <div className="flex items-center gap-2 py-4">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                )}

                {/* AI Answer Section - Only show if has LLM answer */}
                {!msg.loading && msg.has_llm_answer && msg.answer && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '')
                            return !inline && match ? (
                              <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                                <SyntaxHighlighter
                                  style={vscDarkPlus}
                                  language={match[1]}
                                  PreTag="div"
                                  customStyle={{
                                    margin: 0,
                                    fontSize: '0.875rem',
                                    padding: '1rem'
                                  }}
                                  wrapLongLines={false}
                                  {...props}
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              </div>
                            ) : (
                              <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs" {...props}>
                                {children}
                              </code>
                            )
                          },
                          p({ children, ...props }: any) {
                            return <p className="break-words text-gray-700 dark:text-gray-300 leading-relaxed" {...props}>{children}</p>
                          },
                          a({ children, ...props }: any) {
                            return <a className="break-all text-blue-600 dark:text-blue-400 hover:underline" {...props}>{children}</a>
                          }
                        }}
                      >
                        {msg.answer}
                      </ReactMarkdown>
                    </div>

                    {/* Sources link at bottom of AI answer */}
                    {msg.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <button
                          type="button"
                          onClick={() => toggleSourcesPanel(idx)}
                          className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          <span>{msg.sources.length} source{msg.sources.length !== 1 ? 's' : ''}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Search Results */}
                {!msg.loading && msg.sources.length > 0 && (
                  // In AI Q&A mode: only show if panel is expanded
                  // In Search mode: always show
                  (msg.has_llm_answer ? showSourcesPanel.get(idx) : true)
                ) && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                          {msg.mode === 'search_only' ? 'Search Results' : 'Code Sources'}
                        </h3>
                        {(() => {
                          // Check if any source is expanded
                          const hasExpandedSource = msg.sources.some((_, sidx) =>
                            expandedSources.has(`${idx}-${sidx}`)
                          )

                          return (
                            <button
                              type="button"
                              onClick={() =>
                                hasExpandedSource
                                  ? collapseAllSources(idx)
                                  : expandAllSources(idx, msg.sources.length)
                              }
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              {hasExpandedSource ? 'Collapse All' : 'Expand All'}
                            </button>
                          )
                        })()}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Found {msg.sources.length} relevant code snippet{msg.sources.length !== 1 ? 's' : ''}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {msg.sources.map((source, sidx) => {
                        const sourceKey = `${idx}-${sidx}`
                        const isExpanded = expandedSources.has(sourceKey)

                        return (
                          <div key={sidx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                                  {source.filename}
                                </span>
                                <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                                  Lines {source.start_line}-{source.end_line}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleSource(idx, sidx)}
                                className="ml-3 flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="w-3 h-3" />
                                    Hide
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="w-3 h-3" />
                                    View Code
                                  </>
                                )}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="overflow-x-auto">
                                <SyntaxHighlighter
                                  language={source.language}
                                  style={vscDarkPlus}
                                  customStyle={{
                                    margin: 0,
                                    fontSize: '0.75rem',
                                    padding: '1rem'
                                  }}
                                  showLineNumbers
                                  startingLineNumber={source.start_line}
                                  wrapLongLines={false}
                                >
                                  {source.code}
                                </SyntaxHighlighter>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* No Results Message */}
                {!msg.loading && msg.search_message && msg.sources.length === 0 && (
                  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {msg.search_message}
                    </p>
                  </div>
                )}

                {/* LLM Error Banner */}
                {!msg.loading && msg.llm_error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-red-600 dark:text-red-400 text-lg">⚠️</span>
                      <div>
                        <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">
                          Could not generate AI answer
                        </p>
                        <p className="text-xs text-red-800 dark:text-red-200">
                          {msg.llm_error}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Input Area - Fixed at Bottom */}
      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-6 py-4 space-y-3">
          {/* Mode Toggle */}
          <ModeToggle
            mode={mode}
            hasAIKey={hasAIKey}
            onModeChange={setMode}
            onConfigureAI={() => setShowSettingsModal(true)}
          />

          {/* Input Row */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'ai'
                ? "Ask anything about this repository..."
                : "Search for code..."
              }
              className="flex-1 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleQuery}
              disabled={loading || !question.trim()}
              className="px-6 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
            >
              {mode === 'ai' ? 'Ask' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => {
            setShowSettingsModal(false)
            // Small delay to ensure backend has processed the settings
            setTimeout(() => {
              checkAPIKey()
            }, 100)
          }}
        />
      )}
    </div>
  )
}

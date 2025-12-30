'use client'

import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactMarkdown from 'react-markdown'

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
  answer: string
  sources: Source[]
  timestamp: Date
}

interface ChatPanelProps {
  projectId: string
  repoName: string
}

export default function ChatPanel({ projectId, repoName }: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedSources, setExpandedSources] = useState<number | null>(null)

  async function handleQuery() {
    if (!question.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`http://localhost:8000/api/query/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Query failed')
      }

      const data = await res.json()

      setMessages([...messages, {
        question: question,
        answer: data.answer,
        sources: data.sources,
        timestamp: new Date()
      }])

      setQuestion('')
    } catch (e: any) {
      setError(e.message)
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
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
          {messages.map((msg, idx) => (
            <div key={idx} className="space-y-6">
              {/* User Question */}
              <div className="flex justify-end">
                <div className="bg-gray-900 dark:bg-gray-700 text-white rounded-2xl px-5 py-3 max-w-2xl">
                  <p className="text-sm">{msg.question}</p>
                </div>
              </div>

              {/* AI Answer */}
              <div>
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

                  {/* View Source Button */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedSources(expandedSources === idx ? null : idx)}
                      className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      View Source
                    </button>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {msg.sources.length} sources
                    </span>
                  </div>

                  {/* Collapsible Sources */}
                  {expandedSources === idx && msg.sources.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                      {msg.sources.map((source, sidx) => (
                        <div key={sidx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 flex items-center justify-between">
                            <span className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                              {source.filename}
                            </span>
                            <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                              Lines {source.start_line}-{source.end_line}
                            </span>
                          </div>
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Input Area - Fixed at Bottom */}
      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about this repository..."
              className="flex-1 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleQuery}
              disabled={loading || !question.trim()}
              className="px-6 py-3 bg-gray-900 dark:bg-gray-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

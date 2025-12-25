'use client'

import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Source {
  filename: string
  code: string
  language: string
  start_line: number
  end_line: number
  similarity: number
}

interface ChatPanelProps {
  projectId: string
  repoName: string
}

export default function ChatPanel({ projectId, repoName }: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  async function handleQuery() {
    if (!question.trim()) return

    setLoading(true)
    setError('')
    setLoadingMessage('Searching codebase...')

    try {
      const res = await fetch(`http://localhost:8000/api/query/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      })

      setLoadingMessage('Generating answer...')

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Query failed')
      }

      const data = await res.json()
      setAnswer(data.answer)
      setSources(data.sources)
      setQuestion('') // Clear question after successful query
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingMessage('')
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!loading && question.trim()) {
        handleQuery()
      }
    }
  }

  function copyCode(code: string, index: number) {
    navigator.clipboard.writeText(code)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  function exportToMarkdown() {
    let markdown = `# ${repoName} - Code Q&A\n\n`
    markdown += `## Question\n\n${question || 'Previous question'}\n\n`
    markdown += `## Answer\n\n${answer}\n\n`

    if (sources.length > 0) {
      markdown += `## Code Sources\n\n`
      sources.forEach((source, i) => {
        markdown += `### ${i + 1}. ${source.filename} (Lines ${source.start_line}-${source.end_line})\n\n`
        markdown += `**Similarity:** ${Math.round(source.similarity * 100)}%\n\n`
        markdown += `\`\`\`${source.language}\n${source.code}\n\`\`\`\n\n`
      })
    }

    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${repoName.replace('/', '-')}-qa.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function retryQuery() {
    setError('')
    handleQuery()
  }

  return (
    <div className="flex-1 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            💬 Chat with: {repoName}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">Ask questions about this codebase</p>
        </div>
        {answer && (
          <button
            onClick={exportToMarkdown}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            <span>📥</span>
            Export to Markdown
          </button>
        )}
      </div>

      {/* Chat Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Query Input */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-4 sticky top-0 z-10">
          <div className="flex gap-3">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about this code... (Press Enter to send, Shift+Enter for new line)"
              className="flex-1 p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors resize-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              disabled={loading}
              rows={2}
            />
            <button
              onClick={handleQuery}
              disabled={loading || !question.trim()}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-indigo-700 transition-all self-end"
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Ask'
              )}
            </button>
          </div>

          {/* Loading state */}
          {loading && loadingMessage && (
            <div className="mt-3 flex items-center gap-2 text-sm text-blue-600">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {loadingMessage}
            </div>
          )}

          {/* Error with retry */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 text-red-600 rounded-lg border border-red-200 flex justify-between items-center">
              <span className="text-sm">{error}</span>
              <button
                onClick={retryQuery}
                className="ml-4 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Keyboard shortcut hint */}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            💡 Tip: Press <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded">Enter</kbd> to send,
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded ml-1">Shift+Enter</kbd> for new line
          </p>
        </div>

        {/* Answer Section */}
        {answer ? (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center text-gray-800 dark:text-gray-200">
                <span className="text-2xl mr-2">💡</span>
                Answer
              </h2>
              <div className="prose prose-blue max-w-none whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                {answer}
              </div>
            </div>

            {/* Sources with syntax highlighting */}
            {sources.length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-6">
                <h2 className="text-lg font-bold mb-4 flex items-center text-gray-800 dark:text-gray-200">
                  <span className="text-2xl mr-2">📁</span>
                  Code Sources ({sources.length})
                </h2>
                <div className="space-y-4">
                  {sources.map((source, i) => (
                    <div key={i} className="border-2 border-gray-100 dark:border-gray-800 rounded-lg p-4 hover:border-blue-200 dark:hover:border-blue-700 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {source.filename}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400 text-xs ml-3">
                            Lines {source.start_line}-{source.end_line}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs px-2 py-1 rounded-full">
                            {Math.round(source.similarity * 100)}% match
                          </span>
                          <button
                            onClick={() => copyCode(source.code, i)}
                            className="px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-xs transition-colors text-gray-800 dark:text-gray-200"
                            title="Copy code"
                          >
                            {copiedIndex === i ? '✓ Copied' : '📋 Copy'}
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <SyntaxHighlighter
                          language={source.language}
                          style={vscDarkPlus}
                          customStyle={{
                            margin: 0,
                            borderRadius: '0.5rem',
                            fontSize: '0.75rem'
                          }}
                          showLineNumbers
                          startingLineNumber={source.start_line}
                        >
                          {source.code}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center">
              <p className="text-6xl mb-4">💭</p>
              <p className="text-lg font-semibold">Ask a question to get started</p>
              <p className="text-sm mt-2">Try: "How does authentication work?"</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

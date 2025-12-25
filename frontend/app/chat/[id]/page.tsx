'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface Source {
  filename: string
  code: string
  language: string
  start_line: number
  end_line: number
  similarity: number
}

export default function Chat() {
  const params = useParams()
  const projectId = params.id as string

  const [status, setStatus] = useState('checking')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Check indexing status on mount
  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus() {
    try {
      const res = await fetch(`http://localhost:8000/api/status/${projectId}`)
      const data = await res.json()
      setStatus(data.status)

      // If still indexing, check again in 5 seconds
      if (data.status === 'pending' || data.status === 'indexing') {
        setTimeout(checkStatus, 5000)
      }
    } catch (e) {
      console.error('Status check failed:', e)
      setStatus('failed')
    }
  }

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
      setAnswer(data.answer)
      setSources(data.sources)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Loading state while indexing
  if (status === 'pending' || status === 'indexing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center bg-white p-10 rounded-2xl shadow-xl max-w-md">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold mb-3">Indexing repository...</h2>
          <p className="text-gray-600 mb-4">
            This usually takes 1-3 minutes depending on repository size.
          </p>
          <p className="text-sm text-gray-500">
            Status: <span className="font-semibold">{status}</span>
          </p>
        </div>
      </div>
    )
  }

  // Failed state
  if (status === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-pink-100">
        <div className="text-center bg-white p-10 rounded-2xl shadow-xl max-w-md">
          <div className="text-red-600 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-600 mb-3">Indexing failed</h2>
          <p className="text-gray-600 mb-4">
            There was an error indexing this repository.
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Another Repository
          </button>
        </div>
      </div>
    )
  }

  // Main chat interface
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Ask about your code
              </h1>
              <p className="text-gray-600 mt-1">Repository indexed and ready</p>
            </div>
            <button
              onClick={() => window.location.href = '/'}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              ← Index Another Repo
            </button>
          </div>
        </div>

        {/* Query input */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="space-y-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !loading && handleQuery()}
              placeholder="How does authentication work?"
              className="w-full p-4 border-2 border-gray-200 rounded-lg text-lg focus:outline-none focus:border-blue-500 transition-colors"
              disabled={loading}
            />
            <button
              onClick={handleQuery}
              disabled={loading || !question.trim()}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-[1.01]"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Thinking...
                </span>
              ) : (
                'Ask Question'
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Answer */}
        {answer && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center">
                <span className="text-2xl mr-2">💡</span>
                Answer
              </h2>
              <div className="prose prose-blue max-w-none whitespace-pre-wrap text-gray-800">
                {answer}
              </div>
            </div>

            {/* Sources */}
            {sources.length > 0 && (
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                  <span className="text-2xl mr-2">📁</span>
                  Code Sources ({sources.length})
                </h2>
                <div className="space-y-4">
                  {sources.map((source, i) => (
                    <div key={i} className="border-2 border-gray-100 rounded-lg p-4 hover:border-blue-200 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <span className="font-mono text-sm font-semibold text-blue-600">
                            {source.filename}
                          </span>
                          <span className="text-gray-500 text-sm ml-3">
                            Lines {source.start_line}-{source.end_line}
                          </span>
                        </div>
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full">
                          {Math.round(source.similarity * 100)}% match
                        </span>
                      </div>
                      <pre className="text-xs overflow-x-auto bg-gray-900 text-gray-100 p-4 rounded-lg">
                        <code>{source.code}</code>
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
  )
}

'use client'

import { useState } from 'react'

interface IndexModalProps {
  isOpen: boolean
  onClose: () => void
  onIndexComplete: (projectId: string) => void
}

export default function IndexModal({ isOpen, onClose, onIndexComplete }: IndexModalProps) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  async function handleIndex() {
    if (!url) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('http://localhost:8000/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: url })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to start indexing')
      }

      const data = await res.json()

      // Close modal and notify parent
      setUrl('')
      onClose()
      onIndexComplete(data.project_id)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full p-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Index New Repository
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Enter a GitHub repository URL to index
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !loading && handleIndex()}
            placeholder="https://github.com/username/repository"
            className="w-full p-4 border-2 border-gray-200 dark:border-gray-700 rounded-lg text-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            disabled={loading}
            autoFocus
          />

          <button
            onClick={handleIndex}
            disabled={loading || !url}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-lg font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-indigo-700 transition-all"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Starting...
              </span>
            ) : (
              'Index Repository'
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">
            <p className="font-semibold">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Try with popular repositories:</p>
          <div className="flex flex-wrap gap-2">
            {[
              'https://github.com/pallets/flask',
              'https://github.com/fastapi/fastapi',
              'https://github.com/django/django'
            ].map((exampleUrl) => (
              <button
                key={exampleUrl}
                onClick={() => setUrl(exampleUrl)}
                className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300 transition-colors"
              >
                {exampleUrl.split('/').slice(-2).join('/')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

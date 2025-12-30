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
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl transition-colors"
        >
          ✕
        </button>

        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Index New Repository
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
            Paste a public GitHub repository URL
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !loading && handleIndex()}
            placeholder="https://github.com/owner/repository"
            className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
            disabled={loading}
            autoFocus
          />

          <button
            onClick={handleIndex}
            disabled={loading || !url}
            className="w-full bg-gray-900 dark:bg-gray-800 text-white py-2.5 px-4 rounded-md font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Indexing...
              </span>
            ) : (
              'Index Repository'
            )}
          </button>
        </div>

        {error && (
          <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
            <p className="font-medium text-xs">Error</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2.5">Try popular repositories:</p>
          <div className="flex flex-wrap gap-2">
            {[
              'https://github.com/pallets/flask',
              'https://github.com/fastapi/fastapi',
              'https://github.com/django/django'
            ].map((exampleUrl) => (
              <button
                key={exampleUrl}
                onClick={() => setUrl(exampleUrl)}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-gray-700 dark:text-gray-300 font-medium transition-colors"
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

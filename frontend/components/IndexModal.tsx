'use client'

import { useState, useEffect } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

interface IndexModalProps {
  isOpen: boolean
  onClose: () => void
  onIndexComplete: (projectId: string) => Promise<void>
}

export default function IndexModal({ isOpen, onClose, onIndexComplete }: IndexModalProps) {
  const [url, setUrl] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [error, setError] = useState('')

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setIndexing(false)
      setError('')
    }
  }, [isOpen])

  async function handleIndex() {
    if (!url) return

    setIndexing(true)
    setError('')

    try {
      // Start indexing
      const res = await fetch(API_ENDPOINTS.index(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: url })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to start indexing')
      }

      const data = await res.json()

      // Wait for repository list to refresh before closing
      await onIndexComplete(data.project_id)
      onClose()
    } catch (e: any) {
      setError(e.message)
      setIndexing(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full p-6 relative">
        <button
          onClick={onClose}
          disabled={indexing}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            onKeyPress={(e) => e.key === 'Enter' && !indexing && handleIndex()}
            placeholder="https://github.com/owner/repository"
            className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
            autoFocus
            disabled={indexing}
          />

          <button
            onClick={handleIndex}
            disabled={!url || indexing}
            className="w-full bg-gray-900 dark:bg-gray-800 text-white py-2.5 px-4 rounded-md font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
          >
            {indexing ? 'Starting...' : 'Start Indexing'}
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
                disabled={indexing}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-gray-700 dark:text-gray-300 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

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
      <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          disabled={indexing}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Index New Repository
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-1">
            Paste a public GitHub repository URL
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !indexing && url && handleIndex()}
            placeholder="https://github.com/owner/repository"
            className="w-full px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-md text-base focus:outline-none focus:ring-1 focus:ring-accent-blue-400 focus:border-accent-blue-400 transition-shadow bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
            autoFocus
            disabled={indexing}
          />

          <button
            onClick={handleIndex}
            disabled={!url || indexing}
            className={`w-full py-2 px-4 rounded-md font-medium text-base transition-colors ${
              !url || indexing
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200'
            }`}
          >
            {indexing ? 'Indexing…' : 'Index repository'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-accent-red-50 dark:bg-accent-red-900/20 rounded-md border border-accent-red-200 dark:border-accent-red-800">
            <p className="font-medium text-xs text-accent-red-700 dark:text-accent-red-300">Error</p>
            <p className="text-xs text-accent-red-600 dark:text-accent-red-400 mt-0.5">{error}</p>
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-neutral-200 dark:border-neutral-800">
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-2">Try popular repositories:</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              'https://github.com/pallets/flask',
              'https://github.com/fastapi/fastapi',
              'https://github.com/django/django'
            ].map((exampleUrl) => (
              <button
                key={exampleUrl}
                onClick={() => setUrl(exampleUrl)}
                disabled={indexing}
                className="text-xs px-2 py-1 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-150 dark:hover:bg-neutral-850 rounded text-neutral-600 dark:text-neutral-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

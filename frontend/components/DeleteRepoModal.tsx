'use client'

import { useState } from 'react'

interface DeleteRepoModalProps {
  isOpen: boolean
  repoName: string
  projectId: string
  onClose: () => void
  onConfirm: (projectId: string) => Promise<void>
}

export default function DeleteRepoModal({
  isOpen,
  repoName,
  projectId,
  onClose,
  onConfirm
}: DeleteRepoModalProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  async function handleDelete() {
    setDeleting(true)
    setError('')

    try {
      await onConfirm(projectId)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to delete repository')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Delete Repository
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{repoName}</strong>?
          This will permanently remove all associated issues, PRs, and indexed data.
        </p>

        {error && (
          <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
            <p className="text-xs font-medium">Error</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

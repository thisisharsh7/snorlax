'use client'

import { useState, useEffect } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

interface IndexModalProps {
  isOpen: boolean
  onClose: () => void
  onIndexComplete: (projectId: string) => void
}

interface Stage {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
}

const INITIAL_STAGES: Stage[] = [
  { id: 'clone', title: 'Cloning repository', status: 'pending' },
  { id: 'index', title: 'Indexing code files', status: 'pending' },
  { id: 'import', title: 'Importing GitHub issues', status: 'pending' },
  { id: 'ready', title: 'Ready for triage!', status: 'pending' }
]

export default function IndexModal({ isOpen, onClose, onIndexComplete }: IndexModalProps) {
  const [url, setUrl] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [stages, setStages] = useState<Stage[]>(INITIAL_STAGES)
  const [complete, setComplete] = useState(false)
  const [importStarted, setImportStarted] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setIndexing(false)
      setError('')
      setProjectId(null)
      setStages(INITIAL_STAGES)
      setComplete(false)
      setImportStarted(false)
    }
  }, [isOpen])

  // Poll status when indexing
  useEffect(() => {
    if (!projectId || !indexing) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(API_ENDPOINTS.status(projectId))
        if (!res.ok) return

        const data = await res.json()

        if (data.status === 'indexed') {
          // Check if import already started (prevents re-entry from queued intervals)
          if (importStarted) return

          // Mark as started before any async work
          setImportStarted(true)

          // Stop polling immediately to prevent duplicate imports
          clearInterval(interval)

          // Update stages to show indexing complete
          updateStage('clone', 'completed')
          updateStage('index', 'completed')

          // Start importing issues (now only runs once)
          await importIssuesAndPRs()
        } else if (data.status === 'indexing') {
          // Show progress
          updateStage('clone', 'completed')
          updateStage('index', 'in_progress')
        } else if (data.status === 'failed') {
          updateStage('index', 'error')
          setError('Indexing failed. Please try again.')
          setIndexing(false)
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Failed to poll status:', err)
      }
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [projectId, indexing])

  function updateStage(id: string, status: Stage['status']) {
    setStages(prevStages =>
      prevStages.map(stage =>
        stage.id === id ? { ...stage, status } : stage
      )
    )
  }

  async function handleIndex() {
    if (!url) return

    setIndexing(true)
    setError('')
    updateStage('clone', 'in_progress')

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
      setProjectId(data.project_id)

      // Status polling will take over from here
    } catch (e: any) {
      setError(e.message)
      setIndexing(false)
      updateStage('clone', 'error')
    }
  }

  async function importIssuesAndPRs() {
    if (!projectId) return

    try {
      updateStage('import', 'in_progress')

      // Use new fast initial import endpoint
      // This imports first 50 open issues + 50 open PRs, then starts background job
      const res = await fetch(API_ENDPOINTS.importInitial(projectId), {
        method: 'POST'
      })

      if (!res.ok) {
        throw new Error('Failed to start initial import')
      }

      const data = await res.json()

      // Handle both new job and already-syncing cases
      if (data.status === 'already_syncing') {
        console.log('Sync already in progress:', data)
        console.log(`Job ${data.job_id} is already running`)
        // Still mark as complete since sync is happening
        updateStage('import', 'completed')
        updateStage('ready', 'completed')
        setIndexing(false)
        setComplete(true)
      } else if (data.status === 'initial_complete') {
        console.log('Initial import complete:', data)
        console.log(`Imported ${data.issues.imported} issues and ${data.prs.imported} PRs`)
        console.log('Background job started, will continue fetching remaining data')
        // Initial batch imported successfully, background job is running
        updateStage('import', 'completed')
        updateStage('ready', 'completed')
        setIndexing(false)
        setComplete(true)
      } else {
        throw new Error('Unexpected response status')
      }
    } catch (err: any) {
      console.error('Failed to import issues/PRs:', err)
      updateStage('import', 'error')
      setError(err.message)
      setIndexing(false)
    }
  }

  function handleViewDashboard() {
    if (projectId) {
      onIndexComplete(projectId)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full p-6 relative">
        {!complete && (
          <button
            onClick={onClose}
            disabled={indexing}
            className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        )}

        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {complete ? 'Repository Ready!' : 'Index New Repository'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
            {complete
              ? 'Your repository has been indexed and issues imported'
              : 'Paste a public GitHub repository URL'}
          </p>
        </div>

        {!indexing && !complete && (
          <>
            <div className="space-y-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !indexing && handleIndex()}
                placeholder="https://github.com/owner/repository"
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                autoFocus
              />

              <button
                onClick={handleIndex}
                disabled={!url}
                className="w-full bg-gray-900 dark:bg-gray-800 text-white py-2.5 px-4 rounded-md font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
              >
                Start Indexing
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
          </>
        )}

        {/* Progress Stages */}
        {(indexing || complete) && (
          <div className="space-y-3">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                {/* Status Icon */}
                <div className="flex-shrink-0">
                  {stage.status === 'completed' && (
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {stage.status === 'in_progress' && (
                    <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                  )}
                  {stage.status === 'error' && (
                    <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                  {stage.status === 'pending' && (
                    <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600" />
                  )}
                </div>

                {/* Stage Title */}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    stage.status === 'completed' ? 'text-green-700 dark:text-green-400' :
                    stage.status === 'in_progress' ? 'text-blue-700 dark:text-blue-400' :
                    stage.status === 'error' ? 'text-red-700 dark:text-red-400' :
                    'text-gray-500 dark:text-gray-400'
                  }`}>
                    {stage.title}
                  </p>
                </div>
              </div>
            ))}

            {complete && (
              <button
                onClick={handleViewDashboard}
                className="w-full mt-4 bg-blue-600 text-white py-3 px-4 rounded-md font-semibold text-sm hover:bg-blue-700 transition-colors"
              >
                View Dashboard →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

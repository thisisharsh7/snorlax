'use client'

import { useState, useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/config'

interface Stage {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
}

interface IndexingTimelineProps {
  projectId: string
  repoName: string
  startTime?: number
  onComplete: () => void
  onError: (error: string) => void
}

const STAGES: Omit<Stage, 'status'>[] = [
  { id: 'clone', title: 'Cloning repository', description: 'Downloading repository from GitHub' },
  { id: 'index', title: 'Indexing code files', description: 'Analyzing code structure and building search index' },
  { id: 'import', title: 'Importing issues & PRs', description: 'Finalizing repository setup' }
]

export default function IndexingTimeline({
  projectId,
  repoName,
  startTime: providedStartTime,
  onComplete,
  onError
}: IndexingTimelineProps) {
  const [stages, setStages] = useState<Stage[]>(
    STAGES.map(s => ({ ...s, status: 'pending' as const }))
  )
  // Use provided start time, or fall back to current time if not provided
  const [startTime] = useState(providedStartTime || Date.now())
  const [error, setError] = useState<string | null>(null)
  const [importStarted, setImportStarted] = useState(false)

  // Poll status and update stages
  useEffect(() => {
    let mounted = true
    const interval = setInterval(async () => {
      if (!mounted) return

      try {
        const res = await fetch(API_ENDPOINTS.status(projectId))
        if (!res.ok) throw new Error('Failed to fetch status')

        const data = await res.json()
        const elapsed = (Date.now() - startTime) / 1000 // seconds

        if (data.status === 'indexing') {
          // Time-based stage progression
          updateStages(elapsed)
        } else if (data.status === 'indexed' && !importStarted) {
          // Start import phase
          setImportStarted(true)
          await startImport(mounted)
        } else if (data.status === 'failed') {
          setError(data.error_message || 'Indexing failed')
          markStageError()
          onError(data.error_message || 'Indexing failed')
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }, 2000)

    // Start with first stage active
    updateStageStatus('clone', 'in_progress')

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [projectId, startTime, importStarted, onError])

  function updateStages(elapsed: number) {
    // Don't update if we're already in the import phase (prevents regression)
    const importStage = stages.find(s => s.id === 'import')
    if (importStage && (importStage.status === 'in_progress' || importStage.status === 'completed')) {
      // Already in import phase, don't regress based on time
      return
    }

    if (elapsed < 10) {
      updateStageStatus('clone', 'in_progress')
    } else if (elapsed < 40) {
      updateStageStatus('clone', 'completed')
      updateStageStatus('index', 'in_progress')
    } else {
      updateStageStatus('clone', 'completed')
      updateStageStatus('index', 'completed')
    }
  }

  async function startImport(mounted: boolean) {
    if (!mounted) return

    updateStageStatus('clone', 'completed')
    updateStageStatus('index', 'completed')
    updateStageStatus('import', 'in_progress')

    try {
      // Try to trigger import (might fail during reindex if already imported)
      const res = await fetch(API_ENDPOINTS.importInitial(projectId), { method: 'POST' })

      // If import fails, check if it's because issues already exist (during reindex)
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        console.log('[Import] Initial import returned error, checking sync status:', errorData)

        // Check current sync status - might already be complete
        const syncRes = await fetch(API_ENDPOINTS.syncStatus(projectId))
        const syncData = await syncRes.json()

        if (syncData.status === 'completed' || syncData.status === 'no_jobs') {
          // Import already done (reindex case), mark as complete
          console.log('[Import] Issues already imported, marking as complete')
          updateStageStatus('import', 'completed')
          setTimeout(() => {
            if (mounted) onComplete()
          }, 1000)
          return
        }
        // If sync is still in progress, continue polling below
      }

      // Poll import status
      const pollImport = setInterval(async () => {
        if (!mounted) {
          clearInterval(pollImport)
          return
        }

        try {
          const syncRes = await fetch(API_ENDPOINTS.syncStatus(projectId))
          const syncData = await syncRes.json()

          if (syncData.status === 'completed' || syncData.status === 'no_jobs') {
            clearInterval(pollImport)
            updateStageStatus('import', 'completed')
            setTimeout(() => {
              if (mounted) onComplete()
            }, 1000) // Small delay for visual feedback
          } else if (syncData.status === 'failed') {
            clearInterval(pollImport)
            const errorMsg = 'Failed to import issues'
            setError(errorMsg)
            updateStageStatus('import', 'error')
            onError(errorMsg)
          }
        } catch (err) {
          console.error('Import polling error:', err)
        }
      }, 3000)

      // Cleanup function
      return () => clearInterval(pollImport)
    } catch (err) {
      console.error('Import error:', err)
      // Instead of failing, check if import is already done
      try {
        const syncRes = await fetch(API_ENDPOINTS.syncStatus(projectId))
        const syncData = await syncRes.json()

        if (syncData.status === 'completed' || syncData.status === 'no_jobs') {
          updateStageStatus('import', 'completed')
          setTimeout(() => {
            if (mounted) onComplete()
          }, 1000)
          return
        }
      } catch (syncErr) {
        console.error('Failed to check sync status:', syncErr)
      }

      // If we can't determine status, show error
      const errorMsg = 'Failed to import issues'
      setError(errorMsg)
      updateStageStatus('import', 'error')
      onError(errorMsg)
    }
  }

  function updateStageStatus(id: string, status: Stage['status']) {
    setStages(prev => {
      const targetIndex = prev.findIndex(s => s.id === id)
      if (targetIndex === -1) return prev

      return prev.map((s, index) => {
        if (s.id === id) {
          // Don't regress: completed stages stay completed
          if (s.status === 'completed' && status !== 'completed') {
            return s
          }
          return { ...s, status }
        }
        // Mark all previous stages as completed when setting current stage to in_progress or completed
        if (index < targetIndex && (status === 'in_progress' || status === 'completed')) {
          return { ...s, status: 'completed' }
        }
        return s
      })
    })
  }

  function markStageError() {
    setStages(prev => {
      const inProgressIdx = prev.findIndex(s => s.status === 'in_progress')
      if (inProgressIdx !== -1) {
        return prev.map((s, i) => i === inProgressIdx ? { ...s, status: 'error' as const } : s)
      }
      return prev
    })
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-md w-full">
        {/* Header - only emphasized element */}
        <div className="mb-12">
          <h2 className="text-base font-medium text-gray-900 dark:text-white mb-1">
            Setting up {repoName}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            This will take a few moments
          </p>
        </div>

        {/* Timeline - minimal, left-aligned */}
        <div className="space-y-8">
          {stages.map((stage, index) => (
            <div key={stage.id} className="relative flex items-start gap-3">
              {/* Vertical connector line */}
              {index < stages.length - 1 && (
                <div className="absolute left-1 top-8 w-px h-8">
                  {/* Animated line fill */}
                  <div className="w-full h-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`w-full transition-all duration-300 ease-out ${
                        stage.status === 'completed'
                          ? 'h-full bg-gray-900 dark:bg-gray-100'
                          : 'h-0'
                      }`}
                    />
                  </div>
                </div>
              )}

              {/* Status indicator - minimal circle */}
              <div className="relative z-10 flex-shrink-0 mt-0.5">
                {stage.status === 'completed' && (
                  // Solid black dot
                  <div className="w-2 h-2 rounded-full bg-gray-900 dark:bg-gray-100" />
                )}
                {stage.status === 'in_progress' && (
                  // Black stroke with subtle rotation
                  <div className="w-2 h-2 relative">
                    <div className="absolute inset-0 rounded-full border border-gray-900 dark:border-gray-100" />
                    <div className="absolute inset-0 rounded-full border border-transparent border-t-gray-900 dark:border-t-gray-100 animate-spin"
                         style={{ animationDuration: '2s' }} />
                  </div>
                )}
                {stage.status === 'error' && (
                  // Red dot for errors
                  <div className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-400" />
                )}
                {stage.status === 'pending' && (
                  // Light gray border only
                  <div className="w-2 h-2 rounded-full border border-gray-300 dark:border-gray-600" />
                )}
              </div>

              {/* Content - refined typography */}
              <div className="flex-1 -mt-0.5">
                <h3 className="text-sm font-normal text-gray-900 dark:text-white mb-0.5">
                  {stage.title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {stage.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Error message - minimal */}
        {error && (
          <div className="mt-12 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">
                {error}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

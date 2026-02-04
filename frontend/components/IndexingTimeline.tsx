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
  onComplete: () => void
  onError: (error: string) => void
}

const STAGES: Omit<Stage, 'status'>[] = [
  { id: 'clone', title: 'Cloning repository', description: 'Downloading repository from GitHub' },
  { id: 'index', title: 'Indexing code files', description: 'Analyzing code structure and building search index' },
  { id: 'import', title: 'Importing open issues', description: 'Fetching issues from GitHub API' }
]

export default function IndexingTimeline({
  projectId,
  repoName,
  onComplete,
  onError
}: IndexingTimelineProps) {
  const [stages, setStages] = useState<Stage[]>(
    STAGES.map(s => ({ ...s, status: 'pending' as const }))
  )
  const [error, setError] = useState<string | null>(null)

  // Poll status and update stages based on backend current_stage
  useEffect(() => {
    let mounted = true
    const interval = setInterval(async () => {
      if (!mounted) return

      try {
        const res = await fetch(API_ENDPOINTS.status(projectId))
        if (!res.ok) throw new Error('Failed to fetch status')

        const data = await res.json()

        if (data.status === 'indexing') {
          // Update stages based on backend current_stage
          updateStagesFromBackend(data.current_stage || 'cloning')
        } else if (data.status === 'indexed') {
          // Indexing complete (backend already imported issues as part of indexing)
          updateStageStatus('clone', 'completed')
          updateStageStatus('index', 'completed')
          updateStageStatus('import', 'completed')
          clearInterval(interval)
          setTimeout(() => {
            if (mounted) onComplete()
          }, 1000)
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

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [projectId, onError])

  function updateStagesFromBackend(currentStage: string | null) {
    // Don't update if we're already in the import phase (prevents regression)
    const importStage = stages.find(s => s.id === 'import')
    if (importStage && (importStage.status === 'in_progress' || importStage.status === 'completed')) {
      // Already in import phase, don't regress
      return
    }

    switch (currentStage) {
      case 'cloning':
        updateStageStatus('clone', 'in_progress')
        updateStageStatus('index', 'pending')
        updateStageStatus('import', 'pending')
        break
      case 'indexing_code':
        updateStageStatus('clone', 'completed')
        updateStageStatus('index', 'in_progress')
        updateStageStatus('import', 'pending')
        break
      case 'importing_issues':
        updateStageStatus('clone', 'completed')
        updateStageStatus('index', 'completed')
        updateStageStatus('import', 'in_progress')
        break
      case null:
      case undefined:
        // Stage is null - backend has cleared it, meaning all stages complete
        // But keep showing current state, don't reset
        break
      default:
        // Unknown stage, show first step as active
        updateStageStatus('clone', 'in_progress')
        break
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
                <div className="absolute left-2 top-8 w-px h-8">
                  {/* Animated line fill */}
                  <div className="w-full h-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      className={`w-full transition-all duration-300 ease-out ${
                        stage.status === 'completed'
                          ? 'h-full bg-neutral-900 dark:bg-neutral-100'
                          : 'h-0'
                      }`}
                    />
                  </div>
                </div>
              )}

              {/* Status indicator - clear visual states */}
              <div className="relative z-10 flex-shrink-0 mt-0.5">
                {stage.status === 'completed' && (
                  // Solid dot with checkmark feel
                  <div className="w-4 h-4 rounded-full bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white dark:text-neutral-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {stage.status === 'in_progress' && (
                  // Spinner with distinct blue accent
                  <div className="w-4 h-4 relative">
                    <div className="absolute inset-0 rounded-full border-2 border-neutral-200 dark:border-neutral-700" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent-blue-600 dark:border-t-accent-blue-400 animate-spin"
                         style={{ animationDuration: '1s' }} />
                  </div>
                )}
                {stage.status === 'error' && (
                  // Red dot for errors
                  <div className="w-4 h-4 rounded-full bg-accent-red-600 dark:bg-accent-red-400 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                )}
                {stage.status === 'pending' && (
                  // Light gray border only
                  <div className="w-4 h-4 rounded-full border-2 border-neutral-200 dark:border-neutral-700" />
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

'use client'

import { useState, useEffect } from 'react'
import { API_ENDPOINTS } from '@/lib/config'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  // Load existing keys on mount
  useEffect(() => {
    if (isOpen) {
      loadSettings()
      setValidationMessage(null)
    }
  }, [isOpen])

  async function loadSettings() {
    try {
      const res = await fetch(API_ENDPOINTS.settings())
      if (res.ok) {
        const data = await res.json()
        // Show masked versions
        setAnthropicKey(data.anthropic_key_set ? '••••••••••••••••' : '')
        setGithubToken(data.github_token_set ? '••••••••••••••••' : '')
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function handleSave() {
    setSaving(true)
    setValidationMessage(null)

    try {
      // Helper to determine what to send for each key
      const processKey = (value: string) => {
        if (value === '••••••••••••••••') return undefined  // Masked - don't change
        if (value === '') return ''  // Empty - delete
        return value  // New value - update
      }

      const res = await fetch(API_ENDPOINTS.settings(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ai_provider: 'anthropic',
          anthropic_api_key: processKey(anthropicKey),
          github_token: processKey(githubToken)
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }

      // Show brief success message, then close
      setValidationMessage('Saved')
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (e: any) {
      setValidationMessage(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl max-w-lg w-full p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mb-8">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Settings
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Configure API access for triage features.
          </p>
        </div>

        <div className="space-y-6">
          {/* Anthropic API Key - PRIMARY */}
          <div>
            <label className="block text-base font-medium text-neutral-900 dark:text-neutral-100 mb-1.5">
              Anthropic API Key
            </label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
              Required for issue analysis. Get your key from{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-600 dark:text-neutral-400 underline hover:text-neutral-900 dark:hover:text-neutral-200"
              >
                console.anthropic.com
              </a>
            </p>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-md text-base focus:outline-none focus:ring-1 focus:ring-accent-blue-400 focus:border-accent-blue-400 transition-shadow bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 font-mono"
            />
          </div>

          {/* GitHub Token - OPTIONAL/SECONDARY */}
          <div>
            <label className="block text-sm font-normal text-neutral-600 dark:text-neutral-400 mb-1.5">
              GitHub Personal Access Token <span className="text-neutral-500">(optional)</span>
            </label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
              Increases rate limits for syncing. Create a token at{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-600 dark:text-neutral-400 underline hover:text-neutral-900 dark:hover:text-neutral-200"
              >
                github.com/settings
              </a>
            </p>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="github_pat_..."
              className="w-full px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-md text-base focus:outline-none focus:ring-1 focus:ring-accent-blue-400 focus:border-accent-blue-400 transition-shadow bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 font-mono"
            />
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-2 px-4 rounded-md font-medium text-base transition-colors ${
              saving
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200'
            }`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {/* Validation Message */}
          {validationMessage && (
            <div className="text-center">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {validationMessage}
              </p>
            </div>
          )}
        </div>

        {/* Security Note */}
        <div className="mt-8 pt-6 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <p>
              Keys are encrypted and stored securely on your server.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

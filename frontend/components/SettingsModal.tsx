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
  const [adminPassword, setAdminPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [showWebhookInstructions, setShowWebhookInstructions] = useState(false)
  const [webhookCopied, setWebhookCopied] = useState(false)

  // Load existing keys on mount
  useEffect(() => {
    if (isOpen) {
      loadSettings()
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

  function copyWebhookUrl() {
    const webhookUrl = API_ENDPOINTS.webhookEndpoint()
    navigator.clipboard.writeText(webhookUrl)
    setWebhookCopied(true)
    setTimeout(() => setWebhookCopied(false), 2000)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    try {
      // Validate admin password is provided
      if (!adminPassword) {
        throw new Error('Admin password is required to save settings')
      }

      // Helper to determine what to send for each key
      const processKey = (value: string) => {
        if (value === '••••••••••••••••') return undefined  // Masked - don't change
        if (value === '') return ''  // Empty - delete
        return value  // New value - update
      }

      // Create Basic Auth header
      const adminUsername = 'admin' // Default username
      const credentials = btoa(`${adminUsername}:${adminPassword}`)

      const res = await fetch(API_ENDPOINTS.settings(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${credentials}`
        },
        body: JSON.stringify({
          ai_provider: 'anthropic',
          anthropic_api_key: processKey(anthropicKey),
          github_token: processKey(githubToken)
        })
      })

      if (!res.ok) {
        const data = await res.json()
        if (res.status === 401) {
          throw new Error('Invalid admin password')
        }
        throw new Error(data.detail || 'Failed to save settings')
      }

      setMessage({ type: 'success', text: 'Settings saved successfully!' })
      setAdminPassword('') // Clear password on success
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-xl w-full p-5">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Settings
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">
              Configure API keys for AI-powered triage features.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {/* Anthropic API Key */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Anthropic API Key <span className="font-normal text-gray-500">(Optional)</span>
              </label>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                title="Get your Anthropic API key"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-xs"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Required for AI-powered issue triage and categorization. Claude Sonnet 4.5 • 200K context
            </p>
          </div>

          {/* GitHub Token */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                GitHub Personal Access Token <span className="font-normal text-gray-500">(Optional)</span>
              </label>
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                title="Create a personal access token"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="github_pat_..."
              className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-xs"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              For syncing issues and PRs. Increases rate limit from 60 to 5,000 requests/hour.{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Create token
              </a>
            </p>
          </div>

          {/* Admin Password - Required for Saving */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1 mb-1">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Admin Password <span className="text-red-600">*</span>
              </label>
              <span className="text-xs text-gray-500 dark:text-gray-400">(Required to save changes)</span>
            </div>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-xs"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Set via <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">ADMIN_PASSWORD</code> environment variable in backend. Default username: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">admin</code>
            </p>
          </div>

          {/* Webhook Setup */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                GitHub Webhook (Real-time Updates)
              </label>
              <button
                onClick={() => setShowWebhookInstructions(!showWebhookInstructions)}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {showWebhookInstructions ? 'Hide Instructions' : 'Show Instructions'}
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={API_ENDPOINTS.webhookEndpoint()}
                readOnly
                className="flex-1 px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-xs"
              />
              <button
                onClick={copyWebhookUrl}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md text-xs font-medium transition-colors"
              >
                {webhookCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {showWebhookInstructions && (
              <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                <h4 className="text-xs font-semibold text-gray-900 dark:text-white mb-2">Setup Instructions:</h4>
                <ol className="text-xs text-gray-700 dark:text-gray-300 space-y-1 list-decimal list-inside">
                  <li>Go to your repository on GitHub</li>
                  <li>Navigate to Settings → Webhooks → Add webhook</li>
                  <li>Paste the webhook URL above</li>
                  <li>Set Content type to: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">application/json</code></li>
                  <li>Set a secure secret (optional, for production)</li>
                  <li>Select: <strong>Issues</strong> and <strong>Pull requests</strong> events</li>
                  <li>Ensure Active is checked</li>
                  <li>Click "Add webhook"</li>
                </ol>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  ℹ️ Webhooks enable real-time updates when issues or PRs are created/modified.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Enable webhooks to automatically sync issues and PRs when they change.
            </p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-gray-900 dark:bg-gray-700 text-white py-2 px-4 rounded-md font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          {/* Message */}
          {message && (
            <div className={`p-2 rounded-md border ${
              message.type === 'success'
                ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
            }`}>
              <p className="text-xs font-medium">{message.text}</p>
            </div>
          )}
        </div>

        {/* Security Note */}
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <p>
              Keys are encrypted and stored securely. Never exposed to the frontend.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

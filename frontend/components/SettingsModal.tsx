'use client'

import { useState, useEffect } from 'react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [aiProvider, setAiProvider] = useState('anthropic')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Load existing keys on mount
  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  async function loadSettings() {
    try {
      const res = await fetch('http://localhost:8000/api/settings')
      if (res.ok) {
        const data = await res.json()
        // Load AI provider
        setAiProvider(data.ai_provider || 'anthropic')
        // Show masked versions
        setAnthropicKey(data.anthropic_key_set ? '••••••••••••••••' : '')
        setOpenaiKey(data.openai_key_set ? '••••••••••••••••' : '')
        setOpenrouterKey(data.openrouter_key_set ? '••••••••••••••••' : '')
        setGithubToken(data.github_token_set ? '••••••••••••••••' : '')
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('http://localhost:8000/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_provider: aiProvider,
          anthropic_api_key: anthropicKey,
          openai_api_key: openaiKey,
          openrouter_api_key: openrouterKey,
          github_token: githubToken
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }

      setMessage({ type: 'success', text: 'Settings saved successfully!' })
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
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full p-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              API Settings
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              All keys are optional. Configure only the features you need.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* AI Provider Selection */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 block">
              AI Provider for Snorlax <span className="text-xs font-normal text-gray-500">(Optional)</span>
            </label>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
              className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="anthropic">Anthropic Claude (Recommended)</option>
              <option value="openai">OpenAI GPT</option>
              <option value="openrouter">OpenRouter (Multiple Models)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Only needed for the "Snorlax" feature. Not required for browsing issues and PRs.
            </p>
          </div>

          {/* Anthropic API Key */}
          {aiProvider === 'anthropic' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Anthropic API Key
                </label>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  title="Get your Anthropic API key"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </a>
              </div>
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Model: Claude Sonnet 4.5 • Best for code • 200K context
              </p>
            </div>
          )}

          {/* OpenAI API Key */}
          {aiProvider === 'openai' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  OpenAI API Key
                </label>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  title="Get your OpenAI API key"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </a>
              </div>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Model: GPT-4 • 128K context
              </p>
            </div>
          )}

          {/* OpenRouter API Key */}
          {aiProvider === 'openrouter' && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  OpenRouter API Key
                </label>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  title="Get your OpenRouter API key"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </a>
              </div>
              <input
                type="password"
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Access multiple models: Claude, GPT-4, Gemini, and more
              </p>
            </div>
          )}

          {/* GitHub Token */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                GitHub Fine-Grained Token <span className="text-xs font-normal text-gray-500">(Optional)</span>
              </label>
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                title="Create a fine-grained token"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="github_pat_..."
              className="w-full p-3 border-2 border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Only needed for syncing issues and PRs. Use fine-grained token with "Issues" and "Pull requests" read-only permissions.{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Create fine-grained token
              </a>
            </p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:from-blue-700 hover:to-indigo-700 transition-all"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>

          {/* Message */}
          {message && (
            <div className={`p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
            }`}>
              <p className="text-sm font-semibold">{message.text}</p>
            </div>
          )}
        </div>

        {/* Security Note */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <p>
              Your API keys are stored securely in the database and never exposed in the frontend.
              Keys are encrypted and only used for backend operations.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

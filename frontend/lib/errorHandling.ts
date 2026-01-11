/**
 * Centralized error handling utilities for API requests
 */

export interface ApiError {
  message: string
  type?: string
  statusCode?: number
}

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return res
  } catch (e: any) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error('Request timed out - backend may be unavailable')
    }
    throw e
  }
}

/**
 * Parse error response from API
 */
export async function parseErrorResponse(res: Response): Promise<ApiError> {
  const statusCode = res.status

  // Try to parse JSON error response
  try {
    const data = await res.json()
    const message = data.detail?.message || data.detail || data.message || res.statusText
    const type = data.detail?.type || data.type || 'unknown'

    return {
      message: getHumanReadableError(statusCode, message, type),
      type,
      statusCode
    }
  } catch {
    // Response is not JSON, use status-based message
    return {
      message: getHumanReadableError(statusCode, res.statusText),
      statusCode
    }
  }
}

/**
 * Convert error codes and messages to human-readable format
 */
function getHumanReadableError(
  statusCode: number,
  message: string,
  type?: string
): string {
  // Check for specific error types
  if (type === 'invalid_token' || type === 'missing_token') {
    return 'GitHub token is invalid or not configured. Please check your settings.'
  }

  if (type === 'insufficient_permissions') {
    return 'GitHub token has insufficient permissions. Please use a token with repo access.'
  }

  if (type === 'rate_limit') {
    return message || 'GitHub API rate limit exceeded. Please try again later.'
  }

  // Status code based errors
  switch (statusCode) {
    case 401:
      return 'Authentication failed. GitHub token is invalid or expired.'

    case 403:
      if (message.toLowerCase().includes('rate limit')) {
        return 'GitHub API rate limit exceeded. Please try again later or add a GitHub token in Settings.'
      }
      return 'Access forbidden. Check your GitHub token permissions.'

    case 404:
      return 'Repository not found or not accessible with current GitHub token.'

    case 429:
      return message || 'Too many requests. Please try again in a few moments.'

    case 500:
      return `Server error: ${message}`

    case 502:
    case 503:
    case 504:
      return 'Backend service unavailable. Please try again later.'

    default:
      return message || 'An unexpected error occurred'
  }
}

/**
 * Wrapper for API requests with automatic error handling
 */
export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<T> {
  const res = await fetchWithTimeout(url, options, timeout)

  if (!res.ok) {
    const error = await parseErrorResponse(res)
    throw new Error(error.message)
  }

  return res.json()
}

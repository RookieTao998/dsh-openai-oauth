import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

export type OAuthRequest = <T>(endpoint: string, payload?: unknown) => Promise<T>

/** Use the authenticated Connection carrier on both Web and Desktop. */
export function createOAuthRequest(call: ClientConnectionRpc['call']): OAuthRequest {
  return async <T>(endpoint: string, payload: unknown = {}): Promise<T> => {
    const result = await call('/openai-oauth', endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
}

export function trustedAuthorizationUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    return url.origin === 'https://auth.openai.com'
      && url.username.length === 0 && url.password.length === 0
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

/** Desktop forwards this HTTPS open to the system browser; the UI retains a manual link. */
export function openAuthorizationUrl(raw: string, open: Window['open']): void {
  const url = trustedAuthorizationUrl(raw)
  if (url === undefined) throw new Error('OpenAI sign-in returned an invalid authorization URL.')
  try {
    open(url, '_blank', 'noopener,noreferrer')
  } catch {
    // The settings page keeps its continuation link when browser popup opening fails.
  }
}

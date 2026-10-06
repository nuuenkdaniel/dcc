export const AUTH_REQUIRED_EVENT = 'dcc-auth-required'

export function reportAuthRequired() {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}

export class LogoutError extends Error {
  readonly status?:number
  constructor(status?: number) {
    super(status ? `Logout request failed with status ${status}` : 'Logout response did not confirm sign-out')
    this.name = 'LogoutError'
    this.status=status
  }
}

export async function logout() {
  const response = await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new LogoutError(response.status)
  const result = await response.json().catch(() => null) as { authenticated?: unknown } | null
  if (!result || result.authenticated !== false) throw new LogoutError()
  reportAuthRequired()
}

export async function protectedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  if (response.status === 401) reportAuthRequired()
  return response
}

export const AUTH_REQUIRED_EVENT = 'dcc-auth-required'

export function reportAuthRequired() {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}

export async function protectedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  if (response.status === 401) reportAuthRequired()
  return response
}

// SSRF guard: the server POSTs to a user-supplied URL, so it is pinned to browser-vendor push hosts.

export const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Userinfo enables URL-parser-confusion bypasses.
  if (url.username || url.password) return false;
  return hostAllowed(url.hostname);
}

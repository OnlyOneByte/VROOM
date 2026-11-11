/*
 * SSRF guard for Web Push endpoints. The endpoint is user-supplied and the server POSTs to it, so it
 * must be pinned to browser-vendor push hosts. A host allowlist is a string match, so it is immune to
 * DNS rebinding, and IP-literal hosts never match.
 */

/**
 * Browser-vendor push services; the browser picks the host, not the app. A host matches if it equals
 * an entry or is a subdomain of one, so `fcm.googleapis.com.evil.com` does not match.
 */
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

/**
 * True only for an https URL on an allowed push host with no userinfo. Checked at subscribe time and
 * again before each send.
 */
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

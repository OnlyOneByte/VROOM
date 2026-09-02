/**
 * Push endpoint validation — an SSRF guard (push-notifications, C560 hardening).
 *
 * A Web Push subscription carries an `endpoint` URL that the server later POSTs to (via web-push). That
 * URL is user-supplied JSON — a hand-crafted `POST /push/subscribe` is not something only a real browser
 * can produce — so WITHOUT validation an authenticated user could register `http://169.254.169.254/…`
 * (the EC2 metadata service), `http://127.0.0.1:6379/` (a localhost admin port), or any internal host,
 * turning the send hook into an authenticated request proxy into the internal network (a blind SSRF with
 * a 404/410-vs-other status oracle). ARCC SSRF-mitigation guidance: validate the URL against a STRICT
 * allowlist of approved schemes + domains, reject private/local/metadata addresses, reject userinfo, and
 * filter at the earliest point (SAX-04). This module is that allowlist.
 *
 * Web Push endpoints are ALWAYS one of a small, known set of browser-vendor push services (the browser
 * chooses the host, not the app) — so a positive host-allowlist is both the tightest control and immune
 * to DNS rebinding (it is a string match on vendor domains that are not attacker-controllable; there is
 * no runtime DNS resolution to race). An IP-literal host (the actual SSRF vector) never matches a vendor
 * domain, so it is rejected inherently.
 */

/**
 * The registrable push-service domains. A host passes if it EQUALS one of these or is a dot-suffixed
 * subdomain of one (`endsWith('.' + domain)`) — the `$`-anchored-suffix discipline from the ARCC guide,
 * so `fcm.googleapis.com.evil.com` does NOT match `fcm.googleapis.com`.
 *   - fcm.googleapis.com            — Chrome / Chromium / Edge (FCM)
 *   - push.services.mozilla.com     — Firefox (updates.push.services.mozilla.com + autopush subdomains)
 *   - push.apple.com                — Safari / iOS 16.4+ (web.push.apple.com)
 *   - notify.windows.com            — Edge / WNS (*.notify.windows.com)
 * Extend this list (not the validation logic) if a new browser-vendor push host appears.
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
 * True only for a well-formed https URL whose host is a known push-service vendor domain, with no
 * embedded userinfo. Everything else — http/other schemes, IP-literal hosts (private/loopback/metadata
 * or any representation), localhost, `user:pass@` bypass strings, malformed URLs — is rejected. Used at
 * subscribe time (reject before storing) AND at send time (defense-in-depth: never POST to a rogue row).
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false; // not a parseable absolute URL
  }
  if (url.protocol !== 'https:') return false; // https only (no http/file/gopher/…)
  if (url.username || url.password) return false; // no userinfo — a classic URL-parser-confusion bypass
  return hostAllowed(url.hostname);
}

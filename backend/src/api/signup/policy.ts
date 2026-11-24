export const SIGNUP_MODES = ['open', 'approval', 'invite', 'closed'] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export type SignupRefusal = 'closed' | 'invite_required' | 'domain_not_allowed';

export type SignupDecision =
  | {
      allow: true;
      role: 'admin' | 'member' | 'pending';
      via: 'first_admin' | 'mode' | 'server_invite' | 'share_invite';
    }
  | { allow: false; reason: SignupRefusal };

export interface SignupRequest {
  email: string;
  firstAdmin: boolean;
  mode: SignupMode;
  allowedDomains: readonly string[];
  serverInvite: boolean;
  shareInvite: boolean;
}

export function isSignupMode(value: unknown): value is SignupMode {
  return typeof value === 'string' && (SIGNUP_MODES as readonly string[]).includes(value);
}

export function parseDomains(text: string): string[] {
  const domains = text
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return [...new Set(domains)];
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function decideSignup(request: SignupRequest): SignupDecision {
  if (request.firstAdmin) return { allow: true, role: 'admin', via: 'first_admin' };
  if (request.mode === 'closed') return { allow: false, reason: 'closed' };
  if (request.serverInvite) return { allow: true, role: 'member', via: 'server_invite' };
  if (
    request.allowedDomains.length > 0 &&
    !request.allowedDomains.includes(emailDomain(request.email))
  ) {
    return { allow: false, reason: 'domain_not_allowed' };
  }
  switch (request.mode) {
    case 'open':
      return { allow: true, role: 'member', via: 'mode' };
    case 'approval':
      return { allow: true, role: 'pending', via: request.shareInvite ? 'share_invite' : 'mode' };
    case 'invite':
      return request.shareInvite
        ? { allow: true, role: 'member', via: 'share_invite' }
        : { allow: false, reason: 'invite_required' };
  }
}

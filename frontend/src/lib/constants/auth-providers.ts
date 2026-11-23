import type { Component } from 'svelte';
import { LogIn } from '@lucide/svelte';
import GoogleLogo from '#lib/components/icons/GoogleLogo.svelte';
import GitHubLogo from '#lib/components/icons/GitHubLogo.svelte';

type AuthIcon = Component<{ class?: string }>;

const AUTH_PROVIDER_ICONS: Record<string, AuthIcon> = {
	google: GoogleLogo,
	github: GitHubLogo
};

export function authProviderIcon(providerId: string): AuthIcon {
	return Object.hasOwn(AUTH_PROVIDER_ICONS, providerId)
		? (AUTH_PROVIDER_ICONS[providerId] as AuthIcon)
		: (LogIn as unknown as AuthIcon);
}

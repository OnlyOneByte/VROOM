import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { createTV } from 'tailwind-variants/lite';

export type { VariantProps } from 'tailwind-variants/lite';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const tv = createTV({ twMerge });

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

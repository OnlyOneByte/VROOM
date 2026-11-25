<script lang="ts" module>
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-[650] tabular-nums outline-none transition-[color,background-color,box-shadow,transform] motion-safe:active:scale-[0.98] focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:text-muted-foreground aria-disabled:focus-visible:ring-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default:
					'bg-primary text-primary-foreground hover:bg-primary/90 aria-disabled:bg-primary/50',
				accent:
					'bg-accent-fill text-accent-fill-foreground hover:bg-accent-fill/90 aria-disabled:bg-accent-fill/50',
				destructive:
					'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40 aria-disabled:focus-visible:ring-destructive/80 aria-disabled:bg-destructive/50',
				outline:
					'border border-border-strong bg-background hover:bg-sunk aria-invalid:border-2 aria-disabled:border-border/50 aria-disabled:bg-background/50',
				secondary: 'bg-sunk text-foreground hover:bg-sunk/70 aria-disabled:bg-sunk/50',
				ghost: 'hover:bg-sunk',
				link: 'text-accent-ink underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-9 px-4 has-[>svg]:px-3.5',
				sm: 'h-8 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5',
				lg: 'h-10 px-5 text-[15px] has-[>svg]:px-4',
				icon: 'size-9',
				'icon-sm': 'size-8',
				'icon-lg': 'size-10'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}

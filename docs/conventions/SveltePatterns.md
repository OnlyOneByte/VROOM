# Svelte Component Patterns

Svelte 5 component mechanics for this project. Not repeated here — defer to:
**MainSteering.md** "Svelte 5 Runes Mode" for runes, the no-`$effect`-for-async-data-loading rule,
forbidden syntax (`$:`, `on:`, `|modifier`, `$app/stores`, directives on components) and
"Navigation" for routing (`resolve()` / `#lib/routes`), then "UI Components" for icon imports;
**DesignSystem.md** for the component inventory, import paths, tokens and spacing;
**UIQuality.md** for the four-states bar.

## Component Structure

```svelte
<script lang="ts">
  // 1. Imports
  import { Button } from '#lib/components/ui/button';
  import { vehicleApi } from '#lib/services/vehicle-api';
  import type { Vehicle } from '#lib/types';

  // 2. Props — declare an interface, then destructure
  interface Props {
    vehicleId: string;
    onSave: () => void;
  }
  let { vehicleId, onSave }: Props = $props();

  // 3. State
  let isLoading = $state(false);
  let loadError = $state<string | null>(null);

  // 4. Derived values
  let isValid = $derived(formData.make.length > 0 && formData.model.length > 0);

  // 5. Effects (sparingly — side effects only)
  // 6. Functions
</script>

<!-- 7. Template -->
```

## Props

- Declare an `interface Props` and destructure it (`let { a, b }: Props = $props()`). A few
  older components use an inline object type; new code uses the interface.
- Two-way props use `$bindable`: `let { open = $bindable(), onSync }: Props = $props()`.
- `class` is reserved — rename on destructure: `let { class: className = '' }: Props = $props()`.
- Child → parent communication is callback props (`onSave`, `onSync`, `onPageChange`).

## Snippets (Replaces Slots)

Named `Snippet` props in, `{@render}` out; optional snippets are guarded.
`common/empty-state.svelte` is the reference implementation.

```svelte
<!-- empty-state.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { icon?: Snippet; title: Snippet }
  let { icon, title }: Props = $props();
</script>
{#if icon}{@render icon()}{/if}
<h3>{@render title()}</h3>

<!-- Caller -->
<EmptyState>
  {#snippet icon()}<Bell class="h-8 w-8" />{/snippet}
  {#snippet title()}No reminders yet{/snippet}
</EmptyState>
```

For plain wrapped content, use `children: Snippet` + `{@render children()}`.

## Dialog Pattern (bits-ui via shadcn-svelte)

A dialog owns an `open = $bindable()` prop and is opened by setting parent state — not with
`Dialog.Trigger`. bits-ui v2 has no `asChild` / `builders` API.

```svelte
<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog';
  import { Button } from '#lib/components/ui/button';

  interface Props { open: boolean; onSync: () => void }
  let { open = $bindable(), onSync }: Props = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Backup Now</Dialog.Title>
      <Dialog.Description>Run a backup to all enabled providers</Dialog.Description>
    </Dialog.Header>
    <!-- body -->
    <Dialog.Footer class="flex gap-2">
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={onSync}>Backup Now</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

## Data Loading Pattern

Pages fetch in the component (`onMount`), not in a `load()` function, and render all four
states off `isLoading` / `loadError`:

```svelte
let isLoading = $state(true);
let loadError = $state<string | null>(null);
let vehicles = $state<Vehicle[]>([]);

async function load() {
  isLoading = true;
  loadError = null;
  try {
    vehicles = await vehicleApi.getVehicles();
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Failed to load vehicles';
  } finally {
    isLoading = false;
  }
}
onMount(load);
```

Template: `{#if isLoading}` → `Skeleton`, `{:else if loadError}` → visible message + retry,
`{:else}` → `EmptyState` or the data.

## Conditional Classes

One condition: a ternary in the class string
(`class={isActive ? 'text-foreground' : 'text-muted-foreground'}`). Several: `cn()` from
`#lib/utils` (clsx + tailwind-merge) — `cn('rounded-lg border p-4', isSelected &&
'border-primary', hasError && 'border-destructive')`.

## Common Mistakes to Avoid

- Don't use `export let` for props — use `$props()` destructuring.
- Don't use `createEventDispatcher` — use callback props.
- Don't use `<slot>` or `$$slots` — use `Snippet` props with `{@render}` (guard optional ones).
- Do not use `goto` with `refreshAll` for simple navigation — `goto` alone handles it.

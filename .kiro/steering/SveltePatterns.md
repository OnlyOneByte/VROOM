---
inclusion: fileMatch
fileMatchPattern: "**/*.svelte,**/*.svelte.ts"
---

# Svelte Component Patterns

Quick-reference for common patterns in this project. For full rules, see MainSteering.md and CodeQualityRules.md.

## Component Structure

```svelte
<script lang="ts">
  // 1. Imports
  import { Button } from '$lib/components/ui/button';
  import { vehicleApi } from '$lib/services/vehicle-api';
  import type { Vehicle } from '$lib/types';

  // 2. Props
  let { vehicleId, onSave }: { vehicleId: string; onSave: () => void } = $props();

  // 3. State
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  // 4. Derived values
  let isValid = $derived(formData.make.length > 0 && formData.model.length > 0);

  // 5. Effects (sparingly)
  $effect(() => { /* side effects only */ });

  // 6. Functions
  async function handleSubmit() { /* ... */ }
</script>

<!-- 7. Template -->
<div>...</div>
```

## Form Handling with Superforms

This project uses `sveltekit-superforms` with Zod for form validation:

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zodClient } from 'sveltekit-superforms/adapters';
  import { z } from 'zod';

  const schema = z.object({ name: z.string().min(1) });
  const { form, errors, enhance } = superForm(data.form, {
    validators: zodClient(schema),
  });
</script>

<form method="POST" use:enhance>
  <input bind:value={$form.name} />
  {#if $errors.name}<span class="text-destructive text-sm">{$errors.name}</span>{/if}
</form>
```

## Dialog / Sheet Pattern (bits-ui via shadcn-svelte)

```svelte
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';

  let open = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger asChild let:builder>
    <Button builders={[builder]}>Open</Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Title</Dialog.Title>
      <Dialog.Description>Description</Dialog.Description>
    </Dialog.Header>
    <!-- content -->
    <Dialog.Footer>
      <Button onclick={() => (open = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

## Data Loading Pattern

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { vehicleApi } from '$lib/services/vehicle-api';
  import { LoaderCircle } from 'lucide-svelte';

  let vehicles = $state<Vehicle[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      vehicles = await vehicleApi.getVehicles();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      isLoading = false;
    }
  });
</script>

{#if isLoading}
  <div class="flex justify-center p-8">
    <LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
{:else if error}
  <p class="text-destructive text-sm">{error}</p>
{:else}
  <!-- render data -->
{/if}
```

## Reactive Change Handler (Not $effect for API Calls)

When a select/input change should trigger a data reload:

```svelte
<script lang="ts">
  // ❌ WRONG — $effect causes duplicate calls with onMount
  // $effect(() => { if (selectedId) loadData(); });

  // ✅ CORRECT — explicit change handler
  function handleVehicleChange(newId: string) {
    selectedVehicleId = newId;
    loadExpenses(newId);
  }
</script>

<Select onValueChange={handleVehicleChange}>...</Select>
```

## Conditional Classes

```svelte
<!-- Simple conditional -->
<div class={isActive ? 'text-foreground' : 'text-muted-foreground'}>

<!-- Multiple conditionals with clsx (imported as cn) -->
<script lang="ts">
  import { cn } from '$lib/utils';
</script>
<div class={cn(
  'rounded-lg border p-4',
  isSelected && 'border-primary bg-primary/5',
  hasError && 'border-destructive'
)}>
```

## Event Handling (No on: Directives)

```svelte
<!-- ❌ WRONG (Svelte 4 syntax) -->
<button on:click={handleClick}>
<button on:click|preventDefault={handleSubmit}>

<!-- ✅ CORRECT (Svelte 5 syntax) -->
<button onclick={handleClick}>
<button onclick={(e) => { e.preventDefault(); handleSubmit(); }}>
```

## Snippet Pattern (Replaces Slots)

```svelte
<!-- Parent -->
<Card>
  {#snippet header()}
    <h2>Title</h2>
  {/snippet}
  {#snippet content()}
    <p>Body</p>
  {/snippet}
</Card>

<!-- Card.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { header, content }: { header: Snippet; content: Snippet } = $props();
</script>
<div>
  {@render header()}
  {@render content()}
</div>
```

## Common Mistakes to Avoid

- Don't use `export let` for props — use `$props()` destructuring
- Don't use `createEventDispatcher` — use callback props
- Don't use `$$slots` — use optional `Snippet` props with `{#if snippet}{@render snippet()}{/if}`
- Don't use `<slot>` — use `{@render children()}` with `children: Snippet` prop
- Don't import from `$app/stores` — use `$app/state` (e.g., `import { page } from '$app/state'` then `page.url`)
- Don't use `goto` with `invalidateAll` for simple navigation — `goto` alone handles it

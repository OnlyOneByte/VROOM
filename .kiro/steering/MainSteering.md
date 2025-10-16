<!------------------------------------------------------------------------------------
   Add Rules to this file or a short description and have Kiro refine them for you:   
-------------------------------------------------------------------------------------> 


Make sure you add `--no-pager` to git commands that display a lot of text (like diff).

## Svelte 5 Runes Mode

This project uses Svelte 5 with runes mode. Follow these rules:

### State Management
- Use `let variable = $state(value)` for reactive state
- Use `let variable = $derived(expression)` for computed values
- Use `$effect(() => { ... })` for side effects

### Avoid Legacy Syntax
- **NEVER use `$:` reactive statements** - use `$effect()` or `$derived()` instead
- **NEVER use `$:` for computed values** - use `$derived()` instead
- Examples:
  ```svelte
  // ❌ WRONG (legacy)
  $: doubled = count * 2;
  $: if (count > 5) { doSomething(); }
  
  // ✅ CORRECT (runes)
  let doubled = $derived(count * 2);
  $effect(() => {
    if (count > 5) { doSomething(); }
  });
  ```

### Props
- Use `let { propName } = $props()` for component props
- For optional props with defaults: `let { propName = defaultValue } = $props()`

### Common Patterns
- Reactive assignments: Use `$effect()` to watch changes and update other state
- Computed values: Use `$derived()` for values calculated from other state
- Side effects: Use `$effect()` for DOM manipulation, subscriptions, etc.


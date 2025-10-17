<!------------------------------------------------------------------------------------
   Add Rules to this file or a short description and have Kiro refine them for you:   
-------------------------------------------------------------------------------------> 

Make sure after finishing your task, that `bun run validate` in the backend and `npm run validate` in the frontend are successful without warnings. If there are errors or warnings, fix them even if they existed before your changes. You only have to check the subfolders you modified (so if all changes are in frontend, you only have to validate the frontend)

Minimize task summary to be a few key points, no need for full paragraphs

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

### Class Directives on Components
- **NEVER use `class:` directives on Svelte components** - they only work on HTML elements
- Use regular class bindings with template literals instead
- Examples:
  ```svelte
  // ❌ WRONG (causes SSR error)
  <IconComponent class="base-class" class:mr-3={isExpanded} />
  
  // ✅ CORRECT (use template literal)
  <IconComponent class="base-class {isExpanded ? 'mr-3' : ''}" />
  ```
- Error message: "This type of directive is not valid on components"
- This applies to all directives on components, not just `class:`

## MCP Servers Available

This project has MCP (Model Context Protocol) servers configured for enhanced development assistance:

### Svelte MCP Server
- **Purpose**: Provides Svelte 5 documentation, code validation, and playground generation
- **When to use**:
  - Need to reference Svelte 5 or SvelteKit documentation
  - Validate Svelte component code for common issues
  - Generate Svelte Playground links for testing components
- **Key tools**:
  - `mcp_svelte_list_sections`: List available documentation sections
  - `mcp_svelte_get_documentation`: Fetch specific documentation
  - `mcp_svelte_svelte_autofixer`: Validate and get suggestions for Svelte code
  - `mcp_svelte_playground_link`: Generate playground links for components

### shadcn MCP Server
- **Purpose**: Access shadcn/ui component registry for this project
- **When to use**:
  - Need to find or add UI components
  - Look for component examples and demos
  - Get installation commands for components
- **Key tools**:
  - `mcp_shadcn_search_items_in_registries`: Search for components
  - `mcp_shadcn_view_items_in_registries`: View component details and code
  - `mcp_shadcn_get_item_examples_from_registries`: Find usage examples
  - `mcp_shadcn_get_add_command_for_items`: Get CLI command to add components

### Best Practices
- Always validate Svelte components with `mcp_svelte_svelte_autofixer` before finalizing
- Check shadcn registry for existing components before building custom ones
- Use Svelte documentation tools when unsure about Svelte 5 syntax or features


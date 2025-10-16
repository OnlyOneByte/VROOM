# Design Document: shadcn-ui Standardization

## Overview

This design document outlines the approach for migrating custom-built UI components to shadcn-ui equivalents in the VROOM Car Tracker frontend. The migration will be performed incrementally, component by component, ensuring that all existing functionality is preserved while improving consistency, maintainability, and accessibility.

### Goals
- Standardize on shadcn-ui component library for all UI primitives
- Maintain 100% feature parity with existing components
- Preserve Svelte 5 runes patterns throughout
- Improve accessibility and keyboard navigation
- Reduce custom CSS and maintenance burden

### Non-Goals
- Redesigning the UI or changing user workflows
- Modifying backend APIs or data structures
- Changing the overall application architecture
- Adding new features beyond component standardization

## Architecture

### Component Migration Strategy

The migration will follow a **bottom-up approach**, starting with the most primitive components and working up to complex composite components:

1. **Phase 1: Install Dependencies** - Add all required shadcn-ui components
2. **Phase 2: Primitive Components** - Migrate simple, isolated components (Badge, Avatar, Alert)
3. **Phase 3: Interactive Components** - Migrate components with user interaction (Dropdown Menu, Select, Switch)
4. **Phase 4: Layout Components** - Migrate navigation and layout components (Sheet, Sidebar)
5. **Phase 5: Composite Components** - Update components that use the migrated primitives

### Component Dependency Graph

```
Navigation (Phase 4)
├── Sheet (Phase 4)
├── Sidebar (Phase 4)
└── UserProfile (Phase 3)
    ├── Dropdown Menu (Phase 3)
    └── Avatar (Phase 2)

Status Indicators (Phase 3)
├── Badge (Phase 2)
├── Popover (already installed)
└── Alert (Phase 2)

Forms (Phase 3)
├── Select (Phase 3)
├── Textarea (Phase 3)
├── Switch (Phase 3)
└── Field patterns (Phase 3)

EfficiencyAlerts (Phase 2)
└── Alert (Phase 2)
```

## Components and Interfaces

### 1. Badge Component (Phase 2)

**Purpose:** Replace custom status indicators with shadcn-ui Badge

**Usage Locations:**
- `OfflineIndicator.svelte` - Status badges (offline, syncing, success, error)
- `SyncStatusInline.svelte` - Sync status display
- `Navigation.svelte` - Pending count badge

**Design:**
```svelte
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  
  let variant = $props<'default' | 'secondary' | 'destructive' | 'outline'>();
</script>

<Badge {variant}>
  <slot />
</Badge>
```

**Variants Mapping:**
- Offline/Error → `destructive` (red)
- Syncing/Pending → `secondary` (yellow/blue)
- Success/Online → `default` (green)
- Info → `outline` (gray)

### 2. Alert Component (Phase 2)

**Purpose:** Replace custom alert displays in EfficiencyAlerts

**Usage Locations:**
- `EfficiencyAlerts.svelte` - All alert types (efficiency drop, improvement, erratic, low)

**Design:**
```svelte
<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  
  let variant = $props<'default' | 'destructive'>();
</script>

<Alert {variant}>
  <AlertIcon class="h-4 w-4" />
  <AlertTitle>{title}</AlertTitle>
  <AlertDescription>{description}</AlertDescription>
</Alert>
```

**Variants Mapping:**
- High severity → `destructive`
- Medium severity → `default` with yellow styling
- Positive → `default` with green styling
- Low severity → `default`

**Custom Styling:**
We'll extend the Alert component with custom color variants for yellow (medium) and green (positive) using Tailwind classes.

### 3. Avatar Component (Phase 2)

**Purpose:** Replace custom user icon in UserProfile

**Usage Locations:**
- `UserProfile.svelte` - User profile button

**Design:**
```svelte
<script lang="ts">
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
  
  let user = $props<{ displayName?: string; email?: string; photoURL?: string }>();
  
  let initials = $derived(
    user?.displayName?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U'
  );
</script>

<Avatar>
  <AvatarImage src={user?.photoURL} alt={user?.displayName} />
  <AvatarFallback>{initials}</AvatarFallback>
</Avatar>
```

### 4. Dropdown Menu Component (Phase 3)

**Purpose:** Replace custom dropdown in UserProfile

**Usage Locations:**
- `UserProfile.svelte` - User profile dropdown menu

**Design:**
```svelte
<script lang="ts">
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from '$lib/components/ui/dropdown-menu';
  import { Avatar } from '$lib/components/ui/avatar';
  
  let user = $props();
  let compact = $props<boolean>();
  
  function handleLogout() {
    authStore.logout();
  }
</script>

<DropdownMenu>
  <DropdownMenuTrigger>
    {#if compact}
      <Avatar size="sm" {user} />
    {:else}
      <!-- Full button with name and email -->
    {/if}
  </DropdownMenuTrigger>
  
  <DropdownMenuContent align="end">
    {#if compact}
      <DropdownMenuLabel>
        <div class="flex flex-col">
          <span>{user?.displayName}</span>
          <span class="text-xs text-muted-foreground">{user?.email}</span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
    {/if}
    
    <DropdownMenuItem href="/settings">
      <Settings class="mr-2 h-4 w-4" />
      Settings
    </DropdownMenuItem>
    
    <DropdownMenuItem onclick={handleLogout}>
      <LogOut class="mr-2 h-4 w-4" />
      Sign out
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Key Changes:**
- Remove custom click-outside handling (built into DropdownMenu)
- Remove manual dropdown state management
- Use DropdownMenuItem for navigation and actions

### 5. Select Component (Phase 3)

**Purpose:** Replace native HTML select elements in forms

**Usage Locations:**
- `vehicles/new/+page.svelte` - Term months selector, day of month selector
- `vehicles/[id]/edit/+page.svelte` - Similar selectors
- Any other forms with select dropdowns

**Design:**
```svelte
<script lang="ts">
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
  } from '$lib/components/ui/select';
  
  let value = $state<string>();
  let options = $props<Array<{ value: string; label: string }>>();
</script>

<Select bind:value>
  <SelectTrigger>
    <SelectValue placeholder="Select an option" />
  </SelectTrigger>
  <SelectContent>
    {#each options as option}
      <SelectItem value={option.value}>{option.label}</SelectItem>
    {/each}
  </SelectContent>
</Select>
```

### 6. Textarea Component (Phase 3)

**Purpose:** Replace custom textarea styling

**Usage Locations:**
- `expenses/[id]/edit/+page.svelte` - Description field
- `vehicles/new/+page.svelte` - Any textarea fields
- Other forms with textarea elements

**Design:**
```svelte
<script lang="ts">
  import { Textarea } from '$lib/components/ui/textarea';
  
  let value = $state('');
  let maxlength = $props<number>();
</script>

<Textarea bind:value {maxlength} placeholder="Enter description..." />
```

### 7. Switch Component (Phase 3)

**Purpose:** Replace Checkbox used as toggle in loan form

**Usage Locations:**
- `vehicles/new/+page.svelte` - "This vehicle has a loan" toggle
- `vehicles/[id]/edit/+page.svelte` - Similar toggles

**Design:**
```svelte
<script lang="ts">
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  
  let checked = $state(false);
</script>

<div class="flex items-center space-x-2">
  <Switch bind:checked id="loan-toggle" />
  <Label for="loan-toggle">This vehicle has a loan</Label>
</div>
```

**Rationale:** Switch is semantically more appropriate for on/off toggles, while Checkbox is better for multi-select scenarios.

### 8. Sheet Component (Phase 4)

**Purpose:** Replace custom mobile menu overlay and sidebar

**Usage Locations:**
- `Navigation.svelte` - Mobile navigation menu

**Design:**
```svelte
<script lang="ts">
  import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger
  } from '$lib/components/ui/sheet';
  
  let open = $state(false);
</script>

<!-- Mobile menu button -->
<Sheet bind:open>
  <SheetTrigger asChild>
    <button class="lg:hidden">
      <Menu class="h-6 w-6" />
    </button>
  </SheetTrigger>
  
  <SheetContent side="left" class="w-64">
    <SheetHeader>
      <SheetTitle>
        <div class="flex items-center">
          <span class="text-2xl">🚗</span>
          <span class="ml-3 text-xl font-bold">VROOM</span>
        </div>
      </SheetHeader>
    
    <!-- Navigation items -->
    <nav class="flex-1 px-3 space-y-1 mt-8">
      {#each navigation as item}
        <a href={item.href} onclick={() => open = false}>
          <!-- Navigation item -->
        </a>
      {/each}
    </nav>
    
    <!-- User menu and sync status -->
  </SheetContent>
</Sheet>
```

**Key Changes:**
- Remove custom overlay and transform animations
- Remove manual click-outside handling
- Use Sheet's built-in open/close state management
- Maintain all existing navigation items and functionality

### 9. Sidebar Component (Phase 4)

**Purpose:** Potentially replace desktop sidebar with shadcn-ui Sidebar

**Usage Locations:**
- `Navigation.svelte` - Desktop navigation sidebar

**Design Decision:**
The current desktop sidebar has custom hover-to-expand behavior that works well. We have two options:

**Option A: Keep Custom Desktop Sidebar**
- Maintain current implementation
- Apply shadcn-ui styling utilities for consistency
- Only migrate mobile menu to Sheet

**Option B: Migrate to shadcn-ui Sidebar**
- Use shadcn-ui Sidebar component
- Implement hover-to-expand using Sidebar's collapsible API
- Full shadcn-ui integration

**Recommendation:** Option A for initial migration, Option B as future enhancement. The custom desktop sidebar is working well and the hover-to-expand behavior is non-standard. We should prioritize the mobile menu migration first.

### 10. Popover for Sync Status (Phase 3)

**Purpose:** Replace custom dropdown in SyncStatusIndicator

**Usage Locations:**
- `SyncStatusIndicator.svelte` - Sync status details dropdown

**Design:**
```svelte
<script lang="ts">
  import {
    Popover,
    PopoverContent,
    PopoverTrigger
  } from '$lib/components/ui/popover';
  
  let open = $state(false);
</script>

<Popover bind:open>
  <PopoverTrigger>
    <button class="flex items-center gap-2">
      <StatusIcon />
      <span>{getStatusText()}</span>
    </button>
  </PopoverTrigger>
  
  <PopoverContent align="end" class="w-80">
    <!-- Sync status details -->
  </PopoverContent>
</Popover>
```

**Key Changes:**
- Remove custom click-outside handling
- Use Popover's built-in positioning
- Maintain all existing status information display

## Data Models

No new data models are required. All existing component props and state will be preserved.

### Component Props Mapping

**Before (Custom) → After (shadcn-ui):**

```typescript
// OfflineIndicator - No props change, internal Badge usage
// SyncStatusIndicator - No props change, internal Popover usage
// SyncStatusInline - No props change, internal Badge usage

// UserProfile
interface UserProfileProps {
  user: User;
  compact?: boolean; // Preserved
}

// EfficiencyAlerts
interface EfficiencyAlertsProps {
  vehicles: Array<Vehicle>; // Preserved
}

// Form components - bind:value patterns preserved
```

## Error Handling

### Migration Error Scenarios

1. **Component Not Found**
   - **Scenario:** shadcn-ui component fails to install
   - **Handling:** Provide clear error message with installation command
   - **Recovery:** Manual installation instructions

2. **Breaking API Changes**
   - **Scenario:** shadcn-ui component API differs from expected
   - **Handling:** Adapter pattern to maintain existing interface
   - **Recovery:** Document API differences and create wrapper if needed

3. **Styling Conflicts**
   - **Scenario:** shadcn-ui styles conflict with existing Tailwind classes
   - **Handling:** Use Tailwind's layer system to manage specificity
   - **Recovery:** Override with custom classes in component

4. **Accessibility Regressions**
   - **Scenario:** Migration breaks keyboard navigation or screen reader support
   - **Handling:** Test with keyboard and screen reader after each migration
   - **Recovery:** Add custom ARIA attributes or revert to custom implementation

### Testing Strategy

Each migrated component will be tested for:
- Visual regression (screenshots before/after)
- Functional parity (all interactions work)
- Keyboard navigation (tab order, enter/escape keys)
- Screen reader announcements (ARIA labels)
- Mobile responsiveness (touch targets, viewport)

## Testing Strategy

### Unit Testing

Each migrated component will have unit tests covering:
- Rendering with different props
- User interactions (click, keyboard)
- State changes
- Event emissions

### Integration Testing

Test component interactions:
- Navigation → UserProfile dropdown
- Forms → Select/Textarea/Switch components
- Status indicators → Badge/Popover components

### Visual Regression Testing

- Take screenshots of all components before migration
- Compare after migration to ensure visual parity
- Document intentional visual changes

### Accessibility Testing

- Keyboard navigation testing
- Screen reader testing (NVDA/JAWS/VoiceOver)
- Color contrast verification
- Focus indicator visibility

### Manual Testing Checklist

For each migrated component:
- [ ] Desktop Chrome - All interactions work
- [ ] Desktop Firefox - All interactions work
- [ ] Desktop Safari - All interactions work
- [ ] Mobile iOS Safari - Touch interactions work
- [ ] Mobile Android Chrome - Touch interactions work
- [ ] Keyboard only navigation - All features accessible
- [ ] Screen reader - All content announced correctly

## Implementation Phases

### Phase 1: Install Dependencies (1 task)
- Install all required shadcn-ui components
- Verify components are available in the project

### Phase 2: Primitive Components (3 tasks)
- Migrate to Badge component
- Migrate to Alert component
- Migrate to Avatar component

### Phase 3: Interactive Components (4 tasks)
- Migrate to Dropdown Menu component
- Migrate to Select component
- Migrate to Textarea component
- Migrate to Switch component

### Phase 4: Layout Components (2 tasks)
- Migrate mobile navigation to Sheet component
- Update desktop sidebar styling (optional Sidebar component)

### Phase 5: Integration and Testing (2 tasks)
- Update all dependent components
- Comprehensive testing and bug fixes

## Rollback Strategy

Each component migration will be done in a separate commit, allowing for easy rollback if issues are discovered:

1. **Immediate Rollback:** Git revert the specific commit
2. **Partial Rollback:** Keep some migrations, revert others
3. **Full Rollback:** Revert all commits in the feature branch

## Performance Considerations

### Bundle Size Impact

shadcn-ui components are tree-shakeable and should not significantly increase bundle size:
- Badge: ~1KB
- Alert: ~2KB
- Avatar: ~3KB (includes Radix UI primitives)
- Dropdown Menu: ~5KB (includes Radix UI primitives)
- Select: ~8KB (includes Radix UI primitives)
- Sheet: ~6KB (includes Radix UI primitives)
- Switch: ~3KB (includes Radix UI primitives)
- Textarea: ~1KB

**Total estimated increase:** ~29KB (gzipped: ~10KB)

This is acceptable given the benefits of standardization and reduced custom code maintenance.

### Runtime Performance

shadcn-ui components are built on Radix UI primitives, which are highly optimized:
- No performance regressions expected
- Improved accessibility may add minimal overhead
- Better keyboard navigation handling

## Security Considerations

### XSS Prevention

All shadcn-ui components properly escape user input:
- No `innerHTML` usage
- Proper attribute escaping
- Safe event handling

### Dependency Security

- shadcn-ui components use well-maintained Radix UI primitives
- Regular security updates from Radix UI team
- No known vulnerabilities in current versions

## Documentation Updates

After migration, update:
- Component usage documentation
- Storybook examples (if applicable)
- Developer onboarding guide
- Accessibility guidelines

## Future Enhancements

After successful migration:
1. **Sidebar Component:** Migrate desktop sidebar to shadcn-ui Sidebar
2. **Form Component:** Implement shadcn-ui Form with react-hook-form patterns
3. **Toast Notifications:** Standardize on Sonner for all notifications
4. **Dialog Component:** Use for confirmation dialogs
5. **Tooltip Component:** Add tooltips for icon-only buttons

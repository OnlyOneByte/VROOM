# Design Document: shadcn-ui Phase 2 - Advanced Components

## Overview

This design document outlines Phase 2 of the shadcn-ui standardization effort for the VROOM Car Tracker frontend. Phase 1 successfully migrated basic components (Badge, Alert, Avatar, Dropdown Menu, Select, Textarea, Switch, Sheet, Popover). Phase 2 focuses on advanced components that enhance user experience: AlertDialog, Dialog, Table, Tabs, Accordion, Progress, RadioGroup, ScrollArea, Form patterns, Collapsible, and Empty states.

### Goals
- Implement high and medium priority shadcn-ui components
- Improve user experience with proper modal dialogs and structured data display
- Enhance accessibility with semantic HTML and ARIA attributes
- Maintain 100% feature parity with existing functionality
- Preserve Svelte 5 runes patterns throughout
- Follow frontend best practices for component usage

### Non-Goals
- Power user features (Command Palette, Hover Card, Breadcrumbs)
- Redesigning the UI or changing user workflows
- Modifying backend APIs or data structures
- Adding new features beyond component standardization
- Performance optimization (focus is on standardization)

## Architecture

### Component Migration Strategy

Phase 2 follows a **priority-based approach**, focusing on components that provide the most immediate UX improvements:

1. **Phase 2.1: Modal Components** - AlertDialog, Dialog (delete confirmations, sync conflicts)
2. **Phase 2.2: Data Display** - Table, Progress (expense lists, loan progress)
3. **Phase 2.3: Navigation & Organization** - Tabs, Accordion, Collapsible (multi-section pages, filters)
4. **Phase 2.4: Form Enhancements** - RadioGroup, Form patterns, ScrollArea (better forms, scrolling)
5. **Phase 2.5: Empty States** - Empty component (no data scenarios)

### Component Dependency Graph

```
Delete Confirmations (Phase 2.1)
└── AlertDialog

Sync Conflict Resolver (Phase 2.1)
├── Dialog
└── ScrollArea (Phase 2.4)

Expense Lists (Phase 2.2)
├── Table
└── ScrollArea (Phase 2.4)

Multi-Section Pages (Phase 2.3)
└── Tabs
    ├── Analytics page
    ├── Vehicle detail page
    └── Settings page

Filter Sections (Phase 2.3)
├── Accordion
└── Collapsible

Loan Progress (Phase 2.2)
└── Progress

Expense Form (Phase 2.4)
├── RadioGroup
└── Form patterns

Empty States (Phase 2.5)
└── Empty
```

## Components and Interfaces

### 1. AlertDialog Component (Phase 2.1)

**Purpose:** Replace custom delete confirmation modals with accessible AlertDialog

**Usage Locations:**
- `frontend/src/routes/expenses/+page.svelte` - Delete expense confirmation (line ~807)
- `frontend/src/routes/vehicles/[id]/+page.svelte` - Delete expense confirmation (line ~831)

**Current Implementation:**
```svelte
{#if showDeleteModal && expenseToDelete}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
    <div class="bg-white rounded-lg max-w-md w-full p-6">
      <!-- Delete confirmation content -->
    </div>
  </div>
{/if}
```

**New Design:**
```svelte
<script lang="ts">
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
  } from '$lib/components/ui/alert-dialog';
  
  let showDeleteModal = $state(false);
  let expenseToDelete = $state<Expense | null>(null);
  
  function handleDeleteClick(expense: Expense) {
    expenseToDelete = expense;
    showDeleteModal = true;
  }
  
  async function confirmDelete() {
    if (!expenseToDelete) return;
    await deleteExpense(expenseToDelete.id);
    showDeleteModal = false;
    expenseToDelete = null;
  }
</script>

<AlertDialog bind:open={showDeleteModal}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Expense</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete this {expenseToDelete?.category} expense 
        of ${expenseToDelete?.amount}? This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onclick={confirmDelete}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Key Changes:**
- Remove custom backdrop and modal styling
- Use AlertDialog's built-in focus trap and keyboard handling
- Proper ARIA attributes automatically applied
- Escape key and outside click handling built-in

### 2. Dialog Component (Phase 2.1)

**Purpose:** Replace custom modal in SyncConflictResolver with accessible Dialog

**Usage Locations:**
- `frontend/src/lib/components/SyncConflictResolver.svelte` - Sync conflict resolution modal (line ~58)

**Current Implementation:**
```svelte
{#if showModal && currentConflict}
  <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <!-- Conflict resolution content -->
    </div>
  </div>
{/if}
```

**New Design:**
```svelte
<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/components/ui/dialog';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  
  let showModal = $state(false);
  let currentConflict = $state<Conflict | null>(null);
</script>

<Dialog bind:open={showModal}>
  <DialogContent class="max-w-2xl">
    <DialogHeader>
      <DialogTitle>Sync Conflict</DialogTitle>
      <DialogDescription>
        Choose which version to keep for this {currentConflict?.type}.
      </DialogDescription>
    </DialogHeader>
    
    <ScrollArea class="max-h-[60vh]">
      <!-- Conflict resolution content -->
    </ScrollArea>
  </DialogContent>
</Dialog>
```

**Key Changes:**
- Remove custom backdrop and modal styling
- Use Dialog's built-in focus trap
- Add ScrollArea for long content
- Proper ARIA attributes automatically applied

### 3. Table Component (Phase 2.2)

**Purpose:** Replace custom expense list with semantic Table component

**Usage Locations:**
- `frontend/src/routes/expenses/+page.svelte` - Expense list display

**Current Implementation:**
Custom div-based list with manual styling and sorting

**New Design:**
```svelte
<script lang="ts">
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from '$lib/components/ui/table';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  
  let sortBy = $state<'date' | 'amount' | 'type'>('date');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  
  let sortedExpenses = $derived(
    [...filteredExpenses].sort((a, b) => {
      const order = sortOrder === 'asc' ? 1 : -1;
      if (sortBy === 'date') return (new Date(a.date).getTime() - new Date(b.date).getTime()) * order;
      if (sortBy === 'amount') return (a.amount - b.amount) * order;
      if (sortBy === 'type') return a.type.localeCompare(b.type) * order;
      return 0;
    })
  );
  
  function handleSort(column: typeof sortBy) {
    if (sortBy === column) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = column;
      sortOrder = 'desc';
    }
  }
</script>

<ScrollArea class="h-[600px]">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          <button onclick={() => handleSort('date')} class="flex items-center gap-1">
            Date
            {#if sortBy === 'date'}
              <SortIcon order={sortOrder} />
            {/if}
          </button>
        </TableHead>
        <TableHead>Vehicle</TableHead>
        <TableHead>
          <button onclick={() => handleSort('type')} class="flex items-center gap-1">
            Type
            {#if sortBy === 'type'}
              <SortIcon order={sortOrder} />
            {/if}
          </button>
        </TableHead>
        <TableHead>Category</TableHead>
        <TableHead class="text-right">
          <button onclick={() => handleSort('amount')} class="flex items-center gap-1">
            Amount
            {#if sortBy === 'amount'}
              <SortIcon order={sortOrder} />
            {/if}
          </button>
        </TableHead>
        <TableHead class="text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {#each sortedExpenses as expense (expense.id)}
        {@const IconComponent = getCategoryIcon(expense.category)}
        <TableRow>
          <TableCell>{formatDate(expense.date)}</TableCell>
          <TableCell>{getVehicleName(expense.vehicleId)}</TableCell>
          <TableCell>
            <div class="flex items-center gap-2">
              <IconComponent class="h-4 w-4" />
              {typeLabels[expense.type]}
            </div>
          </TableCell>
          <TableCell>{categoryLabels[expense.category]}</TableCell>
          <TableCell class="text-right font-medium">${expense.amount.toFixed(2)}</TableCell>
          <TableCell class="text-right">
            <button onclick={() => handleEdit(expense)}>Edit</button>
            <button onclick={() => handleDeleteClick(expense)}>Delete</button>
          </TableCell>
        </TableRow>
      {/each}
    </TableBody>
  </Table>
</ScrollArea>
```

**Key Changes:**
- Use semantic HTML table structure
- Proper table headers for screen readers
- ScrollArea for long lists
- Maintain existing sorting functionality
- Better keyboard navigation

### 4. Tabs Component (Phase 2.3)

**Purpose:** Organize multi-section pages with Tabs

**Usage Locations:**
- `frontend/src/routes/analytics/+page.svelte` - Different chart views
- `frontend/src/routes/vehicles/[id]/+page.svelte` - Expenses, maintenance, loan info
- `frontend/src/routes/settings/+page.svelte` - Setting categories

**Design (Analytics Page Example):**
```svelte
<script lang="ts">
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  
  let activeTab = $state('overview');
</script>

<Tabs bind:value={activeTab}>
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="trends">Trends</TabsTrigger>
    <TabsTrigger value="efficiency">Efficiency</TabsTrigger>
    <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
  </TabsList>
  
  <TabsContent value="overview">
    <!-- Dashboard analytics content -->
  </TabsContent>
  
  <TabsContent value="trends">
    <MultiTrendChart {trendData} />
  </TabsContent>
  
  <TabsContent value="efficiency">
    <VehicleEfficiencySummary vehicles={dashboardData?.vehicles} />
    <EfficiencyAlerts vehicles={dashboardData?.vehicles} />
  </TabsContent>
  
  <TabsContent value="breakdown">
    <CategoryBreakdownChart data={dashboardData?.categoryBreakdown} />
  </TabsContent>
</Tabs>
```

**Key Changes:**
- No page reloads when switching tabs
- Proper ARIA attributes (role="tablist", role="tab", role="tabpanel")
- Keyboard navigation with arrow keys
- Visual indication of active tab

### 5. Accordion Component (Phase 2.3)

**Purpose:** Collapsible sections for vehicle cards and filter groups

**Usage Locations:**
- `frontend/src/routes/+page.svelte` - Vehicle cards with expandable details
- `frontend/src/routes/expenses/+page.svelte` - Filter sections

**Design (Vehicle Card Example):**
```svelte
<script lang="ts">
  import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '$lib/components/ui/accordion';
</script>

<div class="card">
  <!-- Vehicle summary always visible -->
  <div class="p-4">
    <h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
    <p>Current Mileage: {vehicle.currentMileage.toLocaleString()} mi</p>
  </div>
  
  <Accordion type="single" collapsible>
    <AccordionItem value="details">
      <AccordionTrigger>More Details</AccordionTrigger>
      <AccordionContent>
        <div class="space-y-2">
          <p>VIN: {vehicle.vin}</p>
          <p>License Plate: {vehicle.licensePlate}</p>
          <p>Purchase Date: {formatDate(vehicle.purchaseDate)}</p>
          {#if vehicle.loan}
            <p>Loan Balance: ${vehicle.loan.currentBalance.toFixed(2)}</p>
          {/if}
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</div>
```

**Key Changes:**
- Smooth expand/collapse animations
- Proper ARIA attributes (aria-expanded, aria-controls)
- Keyboard navigation
- Single or multiple expansion modes

### 6. Progress Component (Phase 2.2)

**Purpose:** Replace custom loan progress bars with accessible Progress component

**Usage Locations:**
- `frontend/src/routes/vehicles/+page.svelte` - Loan progress display (line ~590)

**Current Implementation:**
```svelte
<div class="w-full bg-gray-200 rounded-full h-1.5">
  <div
    class="bg-gradient-to-r from-orange-500 to-orange-600 h-1.5 rounded-full transition-all duration-300"
    style="width: {((vehicle.loan.originalAmount - vehicle.loan.currentBalance) /
      vehicle.loan.originalAmount) *
      100}%"
  ></div>
</div>
```

**New Design:**
```svelte
<script lang="ts">
  import { Progress } from '$lib/components/ui/progress';
  
  let progressValue = $derived(
    ((vehicle.loan.originalAmount - vehicle.loan.currentBalance) /
      vehicle.loan.originalAmount) * 100
  );
</script>

<div class="space-y-1">
  <div class="flex justify-between text-xs text-gray-600">
    <span>Loan Progress</span>
    <span>{Math.round(progressValue)}% paid</span>
  </div>
  <Progress value={progressValue} class="h-1.5" />
</div>
```

**Key Changes:**
- Remove custom inline styles
- Proper ARIA attributes (role="progressbar", aria-valuenow, aria-valuemin, aria-valuemax)
- Screen reader announces progress value
- Smooth animations built-in

### 7. RadioGroup Component (Phase 2.4)

**Purpose:** Replace button group with proper RadioGroup for expense type selection

**Usage Locations:**
- `frontend/src/lib/components/expenses/ExpenseForm.svelte` - Expense type selection

**Current Implementation:**
Button group with manual radio behavior

**New Design:**
```svelte
<script lang="ts">
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group';
  import { Label } from '$lib/components/ui/label';
  
  let selectedType = $state('');
  
  const expenseTypes = [
    { value: 'fuel', label: 'Fuel', icon: Fuel },
    { value: 'maintenance', label: 'Maintenance', icon: Wrench },
    { value: 'repairs', label: 'Repairs', icon: Wrench },
    { value: 'insurance', label: 'Insurance', icon: FileText },
    { value: 'other', label: 'Other', icon: DollarSign }
  ];
</script>

<div class="space-y-2">
  <Label>Expense Type</Label>
  <RadioGroup bind:value={selectedType} class="grid grid-cols-2 gap-2">
    {#each expenseTypes as type}
      {@const IconComponent = type.icon}
      <div class="flex items-center space-x-2 border rounded-lg p-3 hover:bg-gray-50">
        <RadioGroupItem value={type.value} id={type.value} />
        <Label for={type.value} class="flex items-center gap-2 cursor-pointer">
          <IconComponent class="h-4 w-4" />
          {type.label}
        </Label>
      </div>
    {/each}
  </RadioGroup>
</div>
```

**Key Changes:**
- Proper radio semantics (role="radiogroup", role="radio")
- Keyboard navigation with arrow keys
- Single selection enforced
- Better accessibility

### 8. ScrollArea Component (Phase 2.4)

**Purpose:** Consistent scrolling behavior for long lists and content

**Usage Locations:**
- `frontend/src/lib/components/Navigation.svelte` - Mobile navigation menu (line ~130)
- `frontend/src/lib/components/SyncConflictResolver.svelte` - Dialog content (line ~60)
- `frontend/src/routes/expenses/+page.svelte` - Expense table
- Chart containers with overflow

**Design:**
```svelte
<script lang="ts">
  import { ScrollArea } from '$lib/components/ui/scroll-area';
</script>

<!-- Mobile navigation -->
<ScrollArea class="flex-1 px-3 mt-8">
  <nav class="space-y-1">
    {#each navigation as item}
      <!-- Navigation items -->
    {/each}
  </nav>
</ScrollArea>

<!-- Table with horizontal scroll -->
<ScrollArea class="w-full" orientation="horizontal">
  <Table>
    <!-- Table content -->
  </Table>
</ScrollArea>
```

**Key Changes:**
- Custom styled scrollbars
- Touch scrolling support on mobile
- Automatic scrollbar updates
- Horizontal and vertical scrolling support

### 9. Form Component Patterns (Phase 2.4)

**Purpose:** Consistent form validation error display

**Usage Locations:**
- All form pages (expenses, vehicles, settings)

**Design:**
```svelte
<script lang="ts">
  import { FormField, FormFieldError } from '$lib/components/ui/form-field';
  import { Label } from '$lib/components/ui/label';
  import { Input } from '$lib/components/ui/input';
  
  let amount = $state('');
  let errors = $state<Record<string, string>>({});
  
  function validateAmount() {
    if (!amount) {
      errors.amount = 'Amount is required';
    } else if (parseFloat(amount) <= 0) {
      errors.amount = 'Amount must be greater than 0';
    } else {
      delete errors.amount;
    }
  }
</script>

<FormField>
  <Label for="amount">Amount</Label>
  <Input
    id="amount"
    type="number"
    bind:value={amount}
    onblur={validateAmount}
    aria-invalid={!!errors.amount}
    aria-describedby={errors.amount ? 'amount-error' : undefined}
  />
  {#if errors.amount}
    <FormFieldError id="amount-error">{errors.amount}</FormFieldError>
  {/if}
</FormField>
```

**Key Changes:**
- Consistent error display across all forms
- Proper ARIA attributes (aria-invalid, aria-describedby)
- Error messages associated with fields
- Screen reader announcements

### 10. Collapsible Component (Phase 2.3)

**Purpose:** Collapsible filter sections

**Usage Locations:**
- `frontend/src/routes/expenses/+page.svelte` - Filter section

**Design:**
```svelte
<script lang="ts">
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
  import { ChevronDown } from 'lucide-svelte';
  
  let filtersOpen = $state(false);
</script>

<Collapsible bind:open={filtersOpen}>
  <CollapsibleTrigger class="flex items-center justify-between w-full p-4 hover:bg-gray-50">
    <span class="font-medium">Filters</span>
    <ChevronDown class="h-4 w-4 transition-transform {filtersOpen ? 'rotate-180' : ''}" />
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div class="p-4 space-y-4">
      <!-- Filter controls -->
    </div>
  </CollapsibleContent>
</Collapsible>
```

**Key Changes:**
- Smooth expand/collapse animations
- Proper ARIA attributes (aria-expanded, aria-controls)
- Keyboard accessible
- Visual indication of state

### 11. Empty Component (Phase 2.5)

**Purpose:** Helpful empty states when there's no data

**Usage Locations:**
- `frontend/src/routes/expenses/+page.svelte` - No expenses
- `frontend/src/routes/vehicles/+page.svelte` - No vehicles
- `frontend/src/lib/components/analytics/EfficiencyAlerts.svelte` - No alerts

**Design:**
```svelte
<script lang="ts">
  import { Empty } from '$lib/components/ui/empty';
  import { Plus, Car, Receipt } from 'lucide-svelte';
</script>

<!-- No expenses -->
{#if expenses.length === 0}
  <Empty
    icon={Receipt}
    title="No expenses yet"
    description="Start tracking your vehicle expenses to see insights and analytics."
  >
    <a href="/expenses/new" class="btn btn-primary inline-flex items-center gap-2">
      <Plus class="h-4 w-4" />
      Add First Expense
    </a>
  </Empty>
{/if}

<!-- No vehicles -->
{#if vehicles.length === 0}
  <Empty
    icon={Car}
    title="No vehicles yet"
    description="Add your first vehicle to start tracking expenses and maintenance."
  >
    <a href="/vehicles/new" class="btn btn-primary inline-flex items-center gap-2">
      <Plus class="h-4 w-4" />
      Add First Vehicle
    </a>
  </Empty>
{/if}
```

**Key Changes:**
- Consistent empty state design
- Clear call-to-action
- Helpful messaging
- Centered and visually appealing

## Data Models

No new data models are required. All existing component props and state will be preserved.

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

## Testing Strategy

### Manual Testing Checklist

For each migrated component:
- [ ] Desktop Chrome - All interactions work
- [ ] Desktop Firefox - All interactions work
- [ ] Desktop Safari - All interactions work
- [ ] Mobile iOS Safari - Touch interactions work
- [ ] Mobile Android Chrome - Touch interactions work
- [ ] Keyboard only navigation - All features accessible
- [ ] Screen reader - All content announced correctly
- [ ] Visual regression - Matches original design

### Validation

After each component migration:
1. Run `npm run validate` in frontend directory
2. Fix any errors or warnings
3. Test all user interactions
4. Verify accessibility with keyboard and screen reader

## Implementation Phases

### Phase 2.1: Modal Components
- Install Dialog and AlertDialog components
- Migrate delete confirmations to AlertDialog
- Migrate sync conflict resolver to Dialog

### Phase 2.2: Data Display
- Install Table and Progress components
- Migrate expense lists to Table
- Migrate loan progress to Progress

### Phase 2.3: Navigation & Organization
- Install Tabs, Accordion, and Collapsible components
- Add Tabs to analytics, vehicle detail, and settings pages
- Add Accordion to vehicle cards
- Add Collapsible to filter sections

### Phase 2.4: Form Enhancements
- Install RadioGroup and ScrollArea components
- Migrate expense type selection to RadioGroup
- Add ScrollArea to long lists and dialogs
- Implement Form component patterns

### Phase 2.5: Empty States
- Install Empty component
- Add empty states to expenses, vehicles, and alerts

## Performance Considerations

### Bundle Size Impact

Estimated bundle size increase for Phase 2 components:
- Dialog: ~6KB
- AlertDialog: ~6KB
- Table: ~2KB
- Tabs: ~4KB
- Accordion: ~4KB
- Progress: ~2KB
- RadioGroup: ~3KB
- ScrollArea: ~3KB
- Collapsible: ~3KB
- Empty: ~1KB

**Total estimated increase:** ~34KB (gzipped: ~12KB)

This is acceptable given the UX improvements and accessibility benefits.

## Security Considerations

All shadcn-ui components properly escape user input and use safe event handling. No security concerns identified.

## Future Enhancements

After Phase 2 completion:
1. **Command Palette** - Quick navigation for power users
2. **Hover Card** - Quick vehicle info on hover
3. **Breadcrumb Navigation** - Navigation context on detail pages
4. **Data Table** - Advanced table with column visibility, export, bulk actions
5. **Combobox** - Searchable dropdown for large vehicle lists

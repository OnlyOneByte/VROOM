import { definePermissions } from '../../permissions/vocabulary';

export const EXPENSE_PERMISSIONS = definePermissions({
  'vehicle.expense.read': { label: 'See expenses', scope: 'vehicle' },
  'vehicle.expense.write': {
    label: 'Add and edit expenses',
    scope: 'vehicle',
    implies: ['vehicle.expense.read'],
  },
  'vehicle.expense.delete': {
    label: 'Delete any expense',
    scope: 'vehicle',
    implies: ['vehicle.expense.read'],
  },
  'vehicle.expense.delete_own': {
    label: 'Delete their own expenses',
    scope: 'vehicle',
    implies: ['vehicle.expense.read'],
  },
});

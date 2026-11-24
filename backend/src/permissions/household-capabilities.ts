import { definePermissions } from './vocabulary';

export const HOUSEHOLD_PERMISSIONS = definePermissions({
  'household.read': { label: 'See the household', scope: 'household' },
  'household.manage': {
    label: 'Rename, configure or delete the household',
    scope: 'household',
    implies: ['household.read'],
  },
  'household.member.invite': { label: 'Invite members', scope: 'household' },
  'household.member.remove': { label: 'Remove members', scope: 'household' },
  'household.roles.manage': { label: 'Create household roles and assign them', scope: 'household' },
  'household.vehicle.add': { label: 'Add your vehicles to the household', scope: 'household' },
  'household.vehicle.remove': {
    label: 'Remove your vehicles from the household',
    scope: 'household',
  },
  'household.driver.record_others': {
    label: 'Record another member as the driver',
    scope: 'household',
  },
  'household.stats.read_others': {
    label: "See other members' driving stats",
    scope: 'household',
    sensitive: true,
  },
});

import { definePermissions } from '../../permissions/vocabulary';

export const ASSISTANT_PERMISSIONS = definePermissions({
  'vehicle.assistant.use': { label: 'Ask the assistant about the vehicle', scope: 'vehicle' },
  'account.assistant.use': {
    label: 'Use the assistant with your own AI provider',
    scope: 'account',
  },
});

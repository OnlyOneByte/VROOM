import { definePermissions } from './vocabulary';

export const SERVER_PERMISSIONS = definePermissions({
  'server.users.read': { label: 'See accounts on this server', scope: 'server' },
  'server.users.manage': {
    label: 'Disable and re-enable accounts',
    scope: 'server',
    implies: ['server.users.read'],
  },
  'server.users.delete': {
    label: 'Delete accounts',
    scope: 'server',
    implies: ['server.users.read'],
  },
  'server.roles.manage': { label: 'Create roles and assign them', scope: 'server' },
  'server.signup.manage': { label: 'Choose who can sign up', scope: 'server' },
  'server.settings.read': { label: 'See server settings', scope: 'server' },
  'server.settings.write': {
    label: 'Change server settings',
    scope: 'server',
    implies: ['server.settings.read'],
  },
  'server.audit.read': { label: 'See the audit log', scope: 'server' },
  'server.health.read': { label: 'See server health', scope: 'server' },
  'server.ai.use': { label: "Use the server's shared AI key", scope: 'server' },
  'server.private_network.use': {
    label: 'Connect providers to addresses on the private network',
    scope: 'server',
  },
});

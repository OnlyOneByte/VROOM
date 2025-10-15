/**
 * Portainer Integration Tests
 * Tests Portainer stack configuration and compatibility
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'yaml';

// Shared stack configuration
// biome-ignore lint/suspicious/noExplicitAny: YAML config has dynamic structure
let stackConfig: any;

describe('Portainer Stack Configuration Tests', () => {
  beforeAll(async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const stackPath = join(rootDir, 'portainer-stack.yml');
    const content = await readFile(stackPath, 'utf-8');
    stackConfig = yaml.parse(content);
  });

  test('should load and parse Portainer stack file', () => {
    expect(stackConfig).toBeDefined();
    expect(stackConfig.version).toBeDefined();
  });

  test('should have backend service configured', () => {
    expect(stackConfig.services.backend).toBeDefined();

    const backend = stackConfig.services.backend;
    expect(backend.image).toContain('ghcr.io');
    expect(backend.image).toContain('backend');
    expect(backend.container_name).toBe('vroom-backend');
  });

  test('should have frontend service configured', () => {
    expect(stackConfig.services.frontend).toBeDefined();

    const frontend = stackConfig.services.frontend;
    expect(frontend.image).toContain('ghcr.io');
    expect(frontend.image).toContain('frontend');
    expect(frontend.container_name).toBe('vroom-frontend');
  });

  test('should have Portainer-specific labels', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.labels).toBeDefined();
    expect(frontend.labels).toBeDefined();

    // Check for Portainer access control labels
    expect(backend.labels['io.portainer.accesscontrol.teams']).toBe('vroom');
    expect(frontend.labels['io.portainer.accesscontrol.teams']).toBe('vroom');
  });

  test('should have Watchtower labels for auto-updates', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.labels['com.centurylinklabs.watchtower.enable']).toBe('true');
    expect(frontend.labels['com.centurylinklabs.watchtower.enable']).toBe('true');
  });

  test('should have proper restart policies', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.restart).toBe('unless-stopped');
    expect(frontend.restart).toBe('unless-stopped');
  });

  test('should have health checks configured', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.healthcheck).toBeDefined();
    expect(frontend.healthcheck).toBeDefined();

    expect(backend.healthcheck.interval).toBe('30s');
    expect(backend.healthcheck.timeout).toBe('10s');
    expect(backend.healthcheck.retries).toBe(3);
  });

  test('should have persistent volume for database', () => {
    const backend = stackConfig.services.backend;

    expect(backend.volumes).toBeDefined();
    expect(backend.volumes).toContain('vroom-data:/app/data');
  });

  test('should have proper network configuration', () => {
    expect(stackConfig.networks).toBeDefined();
    expect(stackConfig.networks['vroom-network']).toBeDefined();
    expect(stackConfig.networks['vroom-network'].driver).toBe('bridge');
  });

  test('should have volume definitions', () => {
    expect(stackConfig.volumes).toBeDefined();
    expect(stackConfig.volumes['vroom-data']).toBeDefined();
    expect(stackConfig.volumes['vroom-data'].driver).toBe('local');
  });

  test('should use environment variable substitution', () => {
    const backend = stackConfig.services.backend;

    // Check that environment variables use ${VAR} syntax
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing Docker Compose variable syntax
    expect(backend.image).toContain('${GITHUB_REPOSITORY}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing Docker Compose variable syntax
    expect(backend.environment.GOOGLE_CLIENT_ID).toContain('${GOOGLE_CLIENT_ID}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing Docker Compose variable syntax
    expect(backend.environment.SESSION_SECRET).toContain('${SESSION_SECRET}');
  });

  test('should have frontend depend on backend', () => {
    const frontend = stackConfig.services.frontend;

    expect(frontend.depends_on).toBeDefined();
    expect(frontend.depends_on).toContain('backend');
  });

  test('should expose correct ports', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.ports).toBeDefined();
    expect(frontend.ports).toBeDefined();

    // Check port mappings
    const backendPort = backend.ports[0];
    const frontendPort = frontend.ports[0];

    expect(backendPort).toContain('3001');
    expect(frontendPort).toContain('3000');
  });

  test('should have production environment settings', () => {
    const backend = stackConfig.services.backend;
    const frontend = stackConfig.services.frontend;

    expect(backend.environment.NODE_ENV).toBe('production');
    expect(frontend.environment.NODE_ENV).toBe('production');
  });
});

describe('Portainer Deployment Documentation Tests', () => {
  let deploymentDoc: string;

  test('should have deployment documentation', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const docPath = join(rootDir, 'DEPLOYMENT.md');

    deploymentDoc = await readFile(docPath, 'utf-8');

    expect(deploymentDoc).toBeDefined();
    expect(deploymentDoc.length).toBeGreaterThan(0);
  });

  test('should document Portainer installation', () => {
    expect(deploymentDoc).toContain('Portainer');
    expect(deploymentDoc).toContain('Install Portainer');
    expect(deploymentDoc).toContain('docker run');
  });

  test('should document Portainer stack deployment', () => {
    expect(deploymentDoc).toContain('Deploy VROOM via Portainer');
    expect(deploymentDoc).toContain('Stacks');
    expect(deploymentDoc).toContain('Add Stack');
  });

  test('should document required environment variables', () => {
    expect(deploymentDoc).toContain('GOOGLE_CLIENT_ID');
    expect(deploymentDoc).toContain('GOOGLE_CLIENT_SECRET');
    expect(deploymentDoc).toContain('SESSION_SECRET');
    expect(deploymentDoc).toContain('CORS_ORIGINS');
  });

  test('should document Portainer management tasks', () => {
    expect(deploymentDoc).toContain('Managing VROOM in Portainer');
    expect(deploymentDoc).toContain('View Logs');
    expect(deploymentDoc).toContain('Restart Services');
  });

  test('should document health check endpoints', () => {
    expect(deploymentDoc).toContain('/health');
    expect(deploymentDoc).toContain('Health Checks');
  });

  test('should document backup procedures', () => {
    expect(deploymentDoc).toContain('Backup Database');
    expect(deploymentDoc).toContain('Restore Database');
  });

  test('should document troubleshooting steps', () => {
    expect(deploymentDoc).toContain('Troubleshooting');
    expect(deploymentDoc).toContain('Common Issues');
  });

  test('should document security best practices', () => {
    expect(deploymentDoc).toContain('Security Best Practices');
    expect(deploymentDoc).toContain('Strong Secrets');
    expect(deploymentDoc).toContain('HTTPS');
  });
});

describe('Docker Compose Compatibility Tests', () => {
  test('should be compatible with Docker Compose v3.8', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const stackPath = join(rootDir, 'portainer-stack.yml');

    const content = await readFile(stackPath, 'utf-8');
    const config = yaml.parse(content);

    expect(config.version).toBe('3.8');
  });

  test('should use standard Docker Compose syntax', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const stackPath = join(rootDir, 'portainer-stack.yml');

    const content = await readFile(stackPath, 'utf-8');

    // Should not throw on parse
    expect(() => yaml.parse(content)).not.toThrow();
  });

  test('should have valid service definitions', () => {
    expect(stackConfig.services).toBeDefined();
    expect(typeof stackConfig.services).toBe('object');
    expect(Object.keys(stackConfig.services).length).toBeGreaterThan(0);
  });

  test('should have valid volume definitions', () => {
    expect(stackConfig.volumes).toBeDefined();
    expect(typeof stackConfig.volumes).toBe('object');
  });

  test('should have valid network definitions', () => {
    expect(stackConfig.networks).toBeDefined();
    expect(typeof stackConfig.networks).toBe('object');
  });
});

describe('Environment Variable Documentation Tests', () => {
  test('should have .env.example file', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const envPath = join(rootDir, '.env.example');

    const content = await readFile(envPath, 'utf-8');

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(0);
  });

  test('should document all required variables', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const envPath = join(rootDir, '.env.example');

    const content = await readFile(envPath, 'utf-8');

    expect(content).toContain('GITHUB_REPOSITORY');
    expect(content).toContain('GOOGLE_CLIENT_ID');
    expect(content).toContain('GOOGLE_CLIENT_SECRET');
    expect(content).toContain('GOOGLE_REDIRECT_URI');
    expect(content).toContain('SESSION_SECRET');
    expect(content).toContain('CORS_ORIGINS');
    expect(content).toContain('PUBLIC_API_URL');
  });

  test('should have helpful comments', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const envPath = join(rootDir, '.env.example');

    const content = await readFile(envPath, 'utf-8');

    expect(content).toContain('#');
    expect(content).toContain('Configuration');
  });

  test('should document how to generate secrets', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const envPath = join(rootDir, '.env.example');

    const content = await readFile(envPath, 'utf-8');

    expect(content).toContain('openssl rand -base64 32');
  });
});

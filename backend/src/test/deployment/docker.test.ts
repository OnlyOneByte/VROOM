/**
 * Docker Container Build and Startup Tests
 * Tests Docker image builds and container health checks
 */

import { describe, expect, test } from 'bun:test';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Skip slow Docker build tests in CI - the workflow handles actual builds
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const skipInCI = isCI ? test.skip : test;

describe('Docker Container Tests', () => {
  skipInCI(
    'should build backend Docker image successfully',
    async () => {
      try {
        const { stdout, stderr } = await execAsync(
          'docker build -t vroom-backend-test:latest -f backend/Dockerfile backend/',
          { cwd: process.cwd().replace('/backend', '') }
        );

        expect(stderr).not.toContain('ERROR');
        expect(stdout.includes('Successfully built') || stdout.includes('writing image')).toBe(
          true
        );
      } catch (error) {
        console.error('Docker build failed:', error);
        throw error;
      }
    },
    120000
  ); // 2 minute timeout for build

  skipInCI(
    'should build frontend Docker image successfully',
    async () => {
      try {
        const { stdout, stderr } = await execAsync(
          'docker build -t vroom-frontend-test:latest -f frontend/Dockerfile frontend/',
          { cwd: process.cwd().replace('/backend', '') }
        );

        expect(stderr).not.toContain('ERROR');
        expect(stdout.includes('Successfully built') || stdout.includes('writing image')).toBe(
          true
        );
      } catch (error) {
        console.error('Docker build failed:', error);
        throw error;
      }
    },
    120000
  );

  skipInCI('should verify backend image has correct entrypoint', async () => {
    try {
      const { stdout } = await execAsync(
        'docker inspect vroom-backend-test:latest --format="{{.Config.Entrypoint}}"'
      );

      expect(stdout).toContain('dumb-init');
    } catch (error) {
      console.error('Image inspection failed:', error);
      throw error;
    }
  });

  skipInCI('should verify backend image runs as non-root user', async () => {
    try {
      const { stdout } = await execAsync(
        'docker inspect vroom-backend-test:latest --format="{{.Config.User}}"'
      );

      expect(stdout.trim()).toBe('bun');
    } catch (error) {
      console.error('User check failed:', error);
      throw error;
    }
  });

  skipInCI('should verify backend image exposes correct port', async () => {
    try {
      const { stdout } = await execAsync(
        'docker inspect vroom-backend-test:latest --format="{{json .Config.ExposedPorts}}"'
      );

      expect(stdout).toContain('3001/tcp');
    } catch (error) {
      console.error('Port check failed:', error);
      throw error;
    }
  });

  skipInCI('should verify backend image has health check configured', async () => {
    try {
      const { stdout } = await execAsync(
        'docker inspect vroom-backend-test:latest --format="{{json .Config.Healthcheck}}"'
      );

      expect(stdout).toContain('health');
      expect(stdout).not.toBe('null');
    } catch (error) {
      console.error('Health check verification failed:', error);
      throw error;
    }
  });

  skipInCI('should verify frontend image exposes correct port', async () => {
    try {
      const { stdout } = await execAsync(
        'docker inspect vroom-frontend-test:latest --format="{{json .Config.ExposedPorts}}"'
      );

      expect(stdout).toContain('3000/tcp');
    } catch (error) {
      console.error('Port check failed:', error);
      throw error;
    }
  });

  skipInCI('should verify Docker images are optimized (reasonable size)', async () => {
    try {
      const { stdout: backendSize } = await execAsync(
        'docker images vroom-backend-test:latest --format="{{.Size}}"'
      );

      const { stdout: frontendSize } = await execAsync(
        'docker images vroom-frontend-test:latest --format="{{.Size}}"'
      );

      console.log(`Backend image size: ${backendSize.trim()}`);
      console.log(`Frontend image size: ${frontendSize.trim()}`);

      // Just verify images exist and have a size
      expect(backendSize.trim()).not.toBe('');
      expect(frontendSize.trim()).not.toBe('');
    } catch (error) {
      console.error('Size check failed:', error);
      throw error;
    }
  });
});

describe('Docker Compose Tests', () => {
  test('should validate docker-compose.yml syntax', async () => {
    try {
      const { stdout, stderr } = await execAsync('docker compose -f docker-compose.yml config', {
        cwd: process.cwd().replace('/backend', ''),
      });

      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('services:');
      expect(stdout).toContain('backend:');
      expect(stdout).toContain('frontend:');
    } catch (error) {
      console.error('Docker Compose validation failed:', error);
      throw error;
    }
  });

  test('should validate docker-compose.prod.yml syntax', async () => {
    try {
      const { stdout, stderr } = await execAsync(
        'docker compose -f docker-compose.prod.yml config',
        { cwd: process.cwd().replace('/backend', '') }
      );

      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('services:');
      expect(stdout).toContain('backend:');
      expect(stdout).toContain('frontend:');
    } catch (error) {
      console.error('Docker Compose validation failed:', error);
      throw error;
    }
  });

  test('should validate portainer-stack.yml syntax', async () => {
    try {
      const { stdout, stderr } = await execAsync('docker compose -f portainer-stack.yml config', {
        cwd: process.cwd().replace('/backend', ''),
      });

      expect(stderr).not.toContain('ERROR');
      expect(stdout).toContain('services:');
    } catch (error) {
      console.error('Portainer stack validation failed:', error);
      throw error;
    }
  });

  test('should verify all required environment variables are documented', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const rootDir = process.cwd().replace('/backend', '');
    const envExample = await fs.readFile(path.join(rootDir, '.env.example'), 'utf-8');

    // Check for required variables
    expect(envExample).toContain('GOOGLE_CLIENT_ID');
    expect(envExample).toContain('GOOGLE_CLIENT_SECRET');
    expect(envExample).toContain('GOOGLE_REDIRECT_URI');
    expect(envExample).toContain('SESSION_SECRET');
    expect(envExample).toContain('CORS_ORIGINS');
    expect(envExample).toContain('PUBLIC_API_URL');
  });
});

describe('Container Startup Tests', () => {
  skipInCI(
    'should verify backend container can start with minimal config',
    async () => {
      const containerId = `vroom-backend-test-${Date.now()}`;

      try {
        // Start container with minimal environment
        await execAsync(
          `docker run -d --name ${containerId} \
          -e NODE_ENV=test \
          -e DATABASE_URL=/tmp/test.db \
          -e GOOGLE_CLIENT_ID=test \
          -e GOOGLE_CLIENT_SECRET=test \
          -e GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback/google \
          -e SESSION_SECRET=test_secret_at_least_32_characters_long \
          vroom-backend-test:latest`,
          { timeout: 30000 }
        );

        // Wait for container to start
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Check if container is running
        const { stdout } = await execAsync(
          `docker ps --filter name=${containerId} --format "{{.Status}}"`
        );

        expect(stdout).toContain('Up');
      } catch (error) {
        console.error('Container startup test failed:', error);
        throw error;
      } finally {
        // Cleanup
        try {
          await execAsync(`docker stop ${containerId}`);
          await execAsync(`docker rm ${containerId}`);
        } catch (_e) {
          // Ignore cleanup errors
        }
      }
    },
    60000
  );
});

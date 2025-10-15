/**
 * CI/CD Pipeline Tests
 * Tests GitHub Actions workflow configuration and validation
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'yaml';

// Shared workflow configuration
let workflowConfig: any;

describe('GitHub Actions Workflow Tests', () => {
  beforeAll(async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const workflowPath = join(rootDir, '.github/workflows/ci-cd.yml');
    const content = await readFile(workflowPath, 'utf-8');
    workflowConfig = yaml.parse(content);
  });

  test('should load and parse CI/CD workflow file', () => {
    expect(workflowConfig).toBeDefined();
    expect(workflowConfig.name).toBe('VROOM CI/CD Pipeline');
  });

  test('should have correct trigger events', () => {
    expect(workflowConfig.on).toBeDefined();
    expect(workflowConfig.on.push).toBeDefined();
    expect(workflowConfig.on.pull_request).toBeDefined();
    expect(workflowConfig.on.workflow_dispatch).toBeDefined();
    
    expect(workflowConfig.on.push.branches).toContain('main');
    expect(workflowConfig.on.push.branches).toContain('develop');
  });

  test('should have backend test job configured', () => {
    const backendTest = workflowConfig.jobs['backend-test'];
    
    expect(backendTest).toBeDefined();
    expect(backendTest.name).toBe('Backend Tests');
    expect(backendTest['runs-on']).toBe('ubuntu-latest');
    
    // Check for required steps
    const stepNames = backendTest.steps.map((s: any) => s.name);
    expect(stepNames).toContain('Checkout code');
    expect(stepNames).toContain('Setup Bun');
    expect(stepNames).toContain('Install dependencies');
    expect(stepNames).toContain('Run type checking');
    expect(stepNames).toContain('Run linting');
    expect(stepNames).toContain('Run unit tests');
    expect(stepNames).toContain('Build application');
  });

  test('should have frontend test job configured', () => {
    const frontendTest = workflowConfig.jobs['frontend-test'];
    
    expect(frontendTest).toBeDefined();
    expect(frontendTest.name).toBe('Frontend Tests');
    expect(frontendTest['runs-on']).toBe('ubuntu-latest');
    
    // Check for required steps
    const stepNames = frontendTest.steps.map((s: any) => s.name);
    expect(stepNames).toContain('Checkout code');
    expect(stepNames).toContain('Setup Node.js');
    expect(stepNames).toContain('Install dependencies');
    expect(stepNames).toContain('Run type checking');
    expect(stepNames).toContain('Run linting');
    expect(stepNames).toContain('Run tests');
    expect(stepNames).toContain('Build application');
  });

  test('should have Docker build jobs configured', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const buildFrontend = workflowConfig.jobs['build-frontend'];
    
    expect(buildBackend).toBeDefined();
    expect(buildFrontend).toBeDefined();
    
    // Check dependencies
    expect(buildBackend.needs).toBe('backend-test');
    expect(buildFrontend.needs).toBe('frontend-test');
    
    // Check permissions
    expect(buildBackend.permissions.contents).toBe('read');
    expect(buildBackend.permissions.packages).toBe('write');
  });

  test('should have deployment job configured', () => {
    const deploy = workflowConfig.jobs.deploy;
    
    expect(deploy).toBeDefined();
    expect(deploy.name).toBe('Trigger Deployment');
    expect(deploy.needs).toEqual(['build-backend', 'build-frontend']);
    
    // Check conditional execution
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
  });

  test('should use GitHub Container Registry', () => {
    expect(workflowConfig.env.REGISTRY).toBe('ghcr.io');
    expect(workflowConfig.env.BACKEND_IMAGE_NAME).toContain('backend');
    expect(workflowConfig.env.FRONTEND_IMAGE_NAME).toContain('frontend');
  });

  test('should have proper Docker build configuration', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const buildStep = buildBackend.steps.find(
      (s: any) => s.name === 'Build and push Docker image'
    );
    
    expect(buildStep).toBeDefined();
    expect(buildStep.uses).toContain('docker/build-push-action');
    expect(buildStep.with.context).toBe('./backend');
    expect(buildStep.with.file).toBe('./backend/Dockerfile');
    expect(buildStep.with.push).toBe(true);
  });

  test('should have Docker layer caching configured', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const buildStep = buildBackend.steps.find(
      (s: any) => s.name === 'Build and push Docker image'
    );
    
    expect(buildStep.with['cache-from']).toBe('type=gha');
    expect(buildStep.with['cache-to']).toBe('type=gha,mode=max');
  });

  test('should have proper image tagging strategy', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const metaStep = buildBackend.steps.find(
      (s: any) => s.name === 'Extract metadata'
    );
    
    expect(metaStep).toBeDefined();
    expect(metaStep.with.tags).toBeDefined();
    expect(metaStep.with.tags).toContain('type=ref,event=branch');
    expect(metaStep.with.tags).toContain('type=sha');
    expect(metaStep.with.tags).toContain('type=raw,value=latest');
  });
});

describe('Workflow Validation Tests', () => {
  test('should have valid YAML syntax in all workflow files', async () => {
    const rootDir = process.cwd().replace('/backend', '');
    const workflowPath = join(rootDir, '.github/workflows/ci-cd.yml');
    
    const content = await readFile(workflowPath, 'utf-8');
    
    // Should not throw
    expect(() => yaml.parse(content)).not.toThrow();
  });

  test('should have all required GitHub Actions versions specified', () => {
    const backendTest = workflowConfig.jobs['backend-test'];
    const frontendTest = workflowConfig.jobs['frontend-test'];
    
    // Check for version pinning
    const checkoutStep = backendTest.steps.find(
      (s: any) => s.uses?.includes('actions/checkout')
    );
    expect(checkoutStep.uses).toMatch(/@v\d+/);
    
    const setupNode = frontendTest.steps.find(
      (s: any) => s.uses?.includes('actions/setup-node')
    );
    expect(setupNode.uses).toMatch(/@v\d+/);
  });

  test('should have proper working directory configuration', () => {
    const backendTest = workflowConfig.jobs['backend-test'];
    const frontendTest = workflowConfig.jobs['frontend-test'];
    
    expect(backendTest.defaults.run['working-directory']).toBe('./backend');
    expect(frontendTest.defaults.run['working-directory']).toBe('./frontend');
  });

  test('should have deployment webhook notification', () => {
    const deploy = workflowConfig.jobs.deploy;
    const webhookStep = deploy.steps.find(
      (s: any) => s.name === 'Trigger deployment webhook'
    );
    
    expect(webhookStep).toBeDefined();
    expect(webhookStep.if).toContain('DEPLOY_WEBHOOK_URL');
    expect(webhookStep.run).toContain('curl');
  });
});

describe('CI/CD Best Practices Tests', () => {
  test('should run tests before building Docker images', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const buildFrontend = workflowConfig.jobs['build-frontend'];
    
    expect(buildBackend.needs).toBe('backend-test');
    expect(buildFrontend.needs).toBe('frontend-test');
  });

  test('should only build images on push to main/develop', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    
    expect(buildBackend.if).toContain("github.event_name == 'push'");
    expect(buildBackend.if).toContain("github.ref == 'refs/heads/main'");
    expect(buildBackend.if).toContain("github.ref == 'refs/heads/develop'");
  });

  test('should only deploy from main branch', () => {
    const deploy = workflowConfig.jobs.deploy;
    
    expect(deploy.if).toContain("github.event_name == 'push'");
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
  });

  test('should have proper permissions for package publishing', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    
    expect(buildBackend.permissions.contents).toBe('read');
    expect(buildBackend.permissions.packages).toBe('write');
  });

  test('should use GitHub token for registry authentication', () => {
    const buildBackend = workflowConfig.jobs['build-backend'];
    const loginStep = buildBackend.steps.find(
      (s: any) => s.name === 'Log in to GitHub Container Registry'
    );
    
    expect(loginStep.with.password).toBe('${{ secrets.GITHUB_TOKEN }}');
  });
});

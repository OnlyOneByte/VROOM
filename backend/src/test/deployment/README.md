# Deployment Tests

This directory contains tests for Docker containerization, CI/CD pipeline, and Portainer integration.

## Test Files

### 1. `ci-cd.test.ts` - GitHub Actions Workflow Tests
Tests the CI/CD pipeline configuration and validates GitHub Actions workflow.

**What it tests:**
- Workflow file syntax and structure
- Job configurations and dependencies
- Docker build and push configurations
- Deployment triggers
- Best practices compliance

**Requirements:** None (tests configuration files only)

**Run:** `bun test src/test/deployment/ci-cd.test.ts`

### 2. `portainer.test.ts` - Portainer Integration Tests
Tests Portainer stack configuration and deployment documentation.

**What it tests:**
- Portainer stack file syntax
- Service configurations
- Labels and metadata
- Environment variable documentation
- Docker Compose compatibility

**Requirements:** None (tests configuration files only)

**Run:** `bun test src/test/deployment/portainer.test.ts`

### 3. `docker.test.ts` - Docker Container Tests
Tests Docker image builds and container functionality.

**What it tests:**
- Docker image builds
- Container configuration
- Health checks
- Security settings (non-root user)
- Docker Compose syntax validation

**Requirements:** 
- Docker installed and running
- Docker images built (optional for some tests)

**Run:** `bun test src/test/deployment/docker.test.ts`

**Note:** Some tests require Docker images to be built first:
```bash
# Build images before running tests
docker build -t vroom-backend-test:latest -f backend/Dockerfile backend/
docker build -t vroom-frontend-test:latest -f frontend/Dockerfile frontend/
```

## Running All Tests

```bash
# Run all deployment tests
bun run test:deployment

# Or run individually
bun test src/test/deployment/ci-cd.test.ts
bun test src/test/deployment/portainer.test.ts
bun test src/test/deployment/docker.test.ts
```

## Test Categories

### Configuration Tests (No Docker Required)
These tests validate configuration files and don't require Docker:
- ✅ CI/CD workflow validation
- ✅ Portainer stack validation
- ✅ Environment variable documentation
- ✅ Docker Compose syntax validation

### Integration Tests (Docker Required)
These tests require Docker to be installed and running:
- Docker image builds
- Container startup tests
- Health check validation
- Image inspection tests

## Validation Script

For a comprehensive deployment validation, use the validation script:

```bash
# Quick validation (no Docker builds)
./scripts/validate-deployment.sh

# Full validation (includes Docker builds)
./scripts/validate-deployment.sh --build
```

## CI/CD Integration

The GitHub Actions workflow automatically runs these tests:
- Configuration tests run on every push/PR
- Docker builds run on push to main/develop branches
- Images are pushed to GitHub Container Registry

## Expected Results

**Without Docker images built:**
- CI/CD tests: ✅ All pass (19 tests)
- Portainer tests: ✅ All pass (32 tests)
- Docker tests: ⚠️ Some fail (image inspection tests require built images)

**With Docker images built:**
- All tests: ✅ Should pass (64 tests)

## Troubleshooting

### Docker tests failing
**Issue:** Tests fail with "image not found" errors  
**Solution:** Build Docker images first:
```bash
docker build -t vroom-backend-test:latest -f backend/Dockerfile backend/
docker build -t vroom-frontend-test:latest -f frontend/Dockerfile frontend/
```

### Docker Compose validation fails
**Issue:** `docker compose config` command fails  
**Solution:** Ensure Docker Compose is installed and environment variables are set

### Permission errors
**Issue:** Docker commands fail with permission errors  
**Solution:** Add user to docker group or run with sudo:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

## Best Practices

1. **Run configuration tests frequently** - They're fast and don't require Docker
2. **Run Docker tests before deployment** - Validates actual container functionality
3. **Use validation script** - Comprehensive check of entire deployment setup
4. **Keep tests updated** - Update tests when changing Docker or CI/CD configuration

## Related Documentation

- [DEPLOYMENT.md](../../../../DEPLOYMENT.md) - Full deployment guide
- [DOCKER_SETUP_SUMMARY.md](../../../../DOCKER_SETUP_SUMMARY.md) - Implementation summary
- [.github/workflows/ci-cd.yml](../../../../.github/workflows/ci-cd.yml) - CI/CD workflow

#!/bin/bash

# VROOM Deployment Validation Script
# This script validates the deployment configuration and setup

set -e

echo "🔍 VROOM Deployment Validation"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track validation status
ERRORS=0
WARNINGS=0

# Function to print success
success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print error
error() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

# Function to print warning
warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# Function to print info
info() {
    echo "ℹ $1"
}

echo "1. Checking Prerequisites"
echo "-------------------------"

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d ' ' -f3 | cut -d ',' -f1)
    success "Docker installed (version $DOCKER_VERSION)"
else
    error "Docker is not installed"
fi

# Check Docker Compose
if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version --short)
    success "Docker Compose installed (version $COMPOSE_VERSION)"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version | cut -d ' ' -f4 | cut -d ',' -f1)
    success "Docker Compose installed (version $COMPOSE_VERSION)"
else
    error "Docker Compose is not installed"
fi

# Check Bun (for backend)
if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    success "Bun installed (version $BUN_VERSION)"
else
    warning "Bun is not installed (required for local development)"
fi

echo ""
echo "2. Validating Configuration Files"
echo "----------------------------------"

# Check Dockerfiles
if [ -f "backend/Dockerfile" ]; then
    success "Backend Dockerfile exists"
else
    error "Backend Dockerfile not found"
fi

if [ -f "frontend/Dockerfile" ]; then
    success "Frontend Dockerfile exists"
else
    error "Frontend Dockerfile not found"
fi

# Check Docker Compose files
if [ -f "docker-compose.yml" ]; then
    success "docker-compose.yml exists"
    
    # Validate syntax
    if docker compose -f docker-compose.yml config > /dev/null 2>&1; then
        success "docker-compose.yml syntax is valid"
    else
        error "docker-compose.yml has syntax errors"
    fi
else
    error "docker-compose.yml not found"
fi

if [ -f "docker-compose.prod.yml" ]; then
    success "docker-compose.prod.yml exists"
    
    # Validate syntax
    if docker compose -f docker-compose.prod.yml config > /dev/null 2>&1; then
        success "docker-compose.prod.yml syntax is valid"
    else
        error "docker-compose.prod.yml has syntax errors"
    fi
else
    error "docker-compose.prod.yml not found"
fi

if [ -f "portainer-stack.yml" ]; then
    success "portainer-stack.yml exists"
    
    # Validate syntax
    if docker compose -f portainer-stack.yml config > /dev/null 2>&1; then
        success "portainer-stack.yml syntax is valid"
    else
        error "portainer-stack.yml has syntax errors"
    fi
else
    error "portainer-stack.yml not found"
fi

# Check GitHub Actions workflow
if [ -f ".github/workflows/ci-cd.yml" ]; then
    success "GitHub Actions CI/CD workflow exists"
else
    error "GitHub Actions CI/CD workflow not found"
fi

# Check environment files
if [ -f ".env.example" ]; then
    success ".env.example exists"
else
    error ".env.example not found"
fi

if [ -f "backend/.env.example" ]; then
    success "backend/.env.example exists"
else
    warning "backend/.env.example not found"
fi

# Check .dockerignore files
if [ -f "backend/.dockerignore" ]; then
    success "backend/.dockerignore exists"
else
    warning "backend/.dockerignore not found"
fi

if [ -f "frontend/.dockerignore" ]; then
    success "frontend/.dockerignore exists"
else
    warning "frontend/.dockerignore not found"
fi

echo ""
echo "3. Validating Documentation"
echo "---------------------------"

if [ -f "DEPLOYMENT.md" ]; then
    success "DEPLOYMENT.md exists"
    
    # Check for key sections
    if grep -q "Prerequisites" DEPLOYMENT.md; then
        success "Documentation includes Prerequisites section"
    else
        warning "Documentation missing Prerequisites section"
    fi
    
    if grep -q "Portainer" DEPLOYMENT.md; then
        success "Documentation includes Portainer section"
    else
        warning "Documentation missing Portainer section"
    fi
    
    if grep -q "Troubleshooting" DEPLOYMENT.md; then
        success "Documentation includes Troubleshooting section"
    else
        warning "Documentation missing Troubleshooting section"
    fi
else
    error "DEPLOYMENT.md not found"
fi

echo ""
echo "4. Checking Environment Variables"
echo "----------------------------------"

# Check if .env exists
if [ -f ".env" ]; then
    info ".env file exists (checking configuration)"
    
    # Check for required variables
    REQUIRED_VARS=(
        "GOOGLE_CLIENT_ID"
        "GOOGLE_CLIENT_SECRET"
        "SESSION_SECRET"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${var}=" .env 2>/dev/null; then
            VALUE=$(grep "^${var}=" .env | cut -d '=' -f2)
            if [ -n "$VALUE" ] && [ "$VALUE" != "your_"* ]; then
                success "$var is configured"
            else
                warning "$var is set but appears to be a placeholder"
            fi
        else
            warning "$var is not set in .env"
        fi
    done
else
    warning ".env file not found (required for deployment)"
    info "Copy .env.example to .env and configure it"
fi

echo ""
echo "5. Testing Docker Builds (Optional)"
echo "------------------------------------"

if [ "$1" == "--build" ]; then
    info "Building Docker images (this may take a few minutes)..."
    
    # Build backend
    if docker build -t vroom-backend-test:latest -f backend/Dockerfile backend/ > /dev/null 2>&1; then
        success "Backend Docker image builds successfully"
    else
        error "Backend Docker image build failed"
    fi
    
    # Build frontend
    if docker build -t vroom-frontend-test:latest -f frontend/Dockerfile frontend/ > /dev/null 2>&1; then
        success "Frontend Docker image builds successfully"
    else
        error "Frontend Docker image build failed"
    fi
else
    info "Skipping Docker builds (use --build flag to test builds)"
fi

echo ""
echo "================================"
echo "Validation Summary"
echo "================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Your deployment configuration is ready."
    echo "Next steps:"
    echo "  1. Configure .env file with your credentials"
    echo "  2. Run: docker-compose up -d"
    echo "  3. Access the application at http://localhost:5173"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Validation completed with $WARNINGS warning(s)${NC}"
    echo ""
    echo "Your deployment configuration is mostly ready."
    echo "Review the warnings above and fix if necessary."
    exit 0
else
    echo -e "${RED}✗ Validation failed with $ERRORS error(s) and $WARNINGS warning(s)${NC}"
    echo ""
    echo "Please fix the errors above before deploying."
    exit 1
fi

#!/bin/bash

# VROOM Quick Start Script
# Helps developers get started quickly with Docker Compose

set -e

echo "🚗 VROOM Car Tracker - Quick Start"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ .env file not found${NC}"
    echo ""
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env file"
    echo ""
    echo -e "${YELLOW}⚠ IMPORTANT: You need to configure the following in .env:${NC}"
    echo "  - GOOGLE_CLIENT_ID"
    echo "  - GOOGLE_CLIENT_SECRET"
    echo "  - SESSION_SECRET (generate with: openssl rand -base64 32)"
    echo ""
    echo "Get Google OAuth credentials from:"
    echo "  https://console.cloud.google.com/"
    echo ""
    read -p "Press Enter after configuring .env to continue..."
fi

# Validate Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Docker is not running${NC}"
    echo "Please start Docker and try again."
    exit 1
fi

echo -e "${BLUE}Starting VROOM services...${NC}"
echo ""

# Start services
docker-compose up -d

echo ""
echo -e "${GREEN}✓ Services started successfully!${NC}"
echo ""
echo "Access the application:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:3001"
echo "  Health:   http://localhost:3001/health"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f"
echo "  Stop services:    docker-compose down"
echo "  Restart services: docker-compose restart"
echo ""
echo "Happy tracking! 🚗💨"

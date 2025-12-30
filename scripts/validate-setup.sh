#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Validating Code Q&A Setup..."
echo ""

ERRORS=0

# Check Docker
echo -n "Checking Docker... "
if ! docker --version > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker not found${NC}"
    echo "  → Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Check if Docker is running
echo -n "Checking if Docker is running... "
if ! docker ps > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running${NC}"
    echo "  → Start Docker Desktop"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓ Docker is running${NC}"
fi

# Check Python
echo -n "Checking Python... "
if ! python3 --version > /dev/null 2>&1; then
    echo -e "${RED}✗ Python3 not found${NC}"
    echo "  → Install Python 3.9+: https://www.python.org/downloads/"
    ERRORS=$((ERRORS + 1))
else
    PYTHON_VERSION=$(python3 --version | awk '{print $2}')
    echo -e "${GREEN}✓ Python $PYTHON_VERSION${NC}"
fi

# Check Node.js
echo -n "Checking Node.js... "
if ! node --version > /dev/null 2>&1; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo "  → Install Node.js 18+: https://nodejs.org/"
    ERRORS=$((ERRORS + 1))
else
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"
fi

# Check .env file
echo -n "Checking backend/.env file... "
if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}⚠ Not found${NC}"
    echo "  → Run: cp .env.example backend/.env"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓ Found${NC}"

    # Check for sslmode=disable
    if ! grep -q "sslmode=disable" backend/.env; then
        echo -e "${YELLOW}⚠ DATABASE_URL missing sslmode=disable${NC}"
        echo "  → Add ?sslmode=disable to APP_DATABASE_URL"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Check if ports are available
echo -n "Checking port 5432 (PostgreSQL)... "
if lsof -Pi :5432 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port in use${NC}"
    echo "  → A database is already running (this might be ok)"
else
    echo -e "${GREEN}✓ Available${NC}"
fi

echo -n "Checking port 8000 (Backend)... "
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port in use${NC}"
    echo "  → Kill process: lsof -ti:8000 | xargs kill -9"
else
    echo -e "${GREEN}✓ Available${NC}"
fi

echo -n "Checking port 3000 (Frontend)... "
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Port in use${NC}"
    echo "  → Kill process: lsof -ti:3000 | xargs kill -9"
else
    echo -e "${GREEN}✓ Available${NC}"
fi

# Check Python dependencies
echo -n "Checking backend dependencies... "
if [ -d "backend/venv" ]; then
    echo -e "${GREEN}✓ Virtual environment exists${NC}"
else
    echo -e "${YELLOW}⚠ Virtual environment not found${NC}"
    echo "  → Run: make install-backend"
    ERRORS=$((ERRORS + 1))
fi

# Check Node dependencies
echo -n "Checking frontend dependencies... "
if [ -d "frontend/node_modules" ]; then
    echo -e "${GREEN}✓ node_modules exists${NC}"
else
    echo -e "${YELLOW}⚠ node_modules not found${NC}"
    echo "  → Run: make install-frontend"
    ERRORS=$((ERRORS + 1))
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! You're ready to run 'make dev'${NC}"
    exit 0
else
    echo -e "${RED}❌ Found $ERRORS issue(s). Please fix them and try again.${NC}"
    echo ""
    echo "Quick fix: Run 'make setup' to install everything"
    exit 1
fi

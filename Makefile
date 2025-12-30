.PHONY: help validate setup dev test clean db-up db-down db-migrate db-reset install-backend install-frontend env

help:
	@echo "Code Q&A - Development Commands"
	@echo "================================"
	@echo "🚀 Quick Start:"
	@echo "  make setup      - First time setup (run once)"
	@echo "  make dev        - Start application"
	@echo ""
	@echo "📋 Setup Commands:"
	@echo "  validate        - Check if system is ready"
	@echo "  env             - Create .env file from example"
	@echo "  install-backend - Install backend dependencies"
	@echo "  install-frontend- Install frontend dependencies"
	@echo ""
	@echo "🗄️  Database Commands:"
	@echo "  db-up           - Start PostgreSQL database"
	@echo "  db-down         - Stop PostgreSQL database"
	@echo "  db-migrate      - Run database migrations"
	@echo "  db-reset        - Reset database (⚠️  deletes data)"
	@echo ""
	@echo "🧹 Other Commands:"
	@echo "  test            - Run tests"
	@echo "  clean           - Clean up everything"

validate:
	@echo "🔍 Validating setup requirements..."
	@bash scripts/validate-setup.sh

env:
	@echo "📝 Creating .env file..."
	@if [ -f backend/.env ]; then \
		echo "⚠️  backend/.env already exists. Skipping..."; \
	else \
		cp .env.example backend/.env; \
		echo "✅ Created backend/.env from .env.example"; \
		echo "   Edit backend/.env if you need to change database settings"; \
	fi

setup: env db-up install-backend install-frontend db-migrate
	@echo ""
	@echo "✅ Setup complete! Run 'make dev' to start the application."
	@echo ""
	@echo "📝 Next steps:"
	@echo "   1. make dev                    → Start the app"
	@echo "   2. Open http://localhost:3000  → Access the UI"
	@echo "   3. Click Settings (⚙️)          → Add your Anthropic API key"

install-backend:
	@echo "📦 Installing backend dependencies..."
	cd backend && python3 -m venv venv
	cd backend && . venv/bin/activate && pip install -r requirements.txt

install-frontend:
	@echo "📦 Installing frontend dependencies..."
	cd frontend && npm install

dev:
	@echo "🚀 Starting development servers..."
	@echo "Backend: http://localhost:8000"
	@echo "Frontend: http://localhost:3000"
	@echo "API Docs: http://localhost:8000/docs"
	@docker-compose -f infra/docker-compose.yml up -d
	@cd backend && . venv/bin/activate && uvicorn main:app --reload --port 8000 &
	@cd frontend && npm run dev

db-up:
	@echo "🐘 Starting PostgreSQL database..."
	docker-compose -f infra/docker-compose.yml up -d
	@echo "✅ Database is running on localhost:5432"

db-down:
	@echo "⏹  Stopping PostgreSQL database..."
	docker-compose -f infra/docker-compose.yml down

db-migrate:
	@echo "🔄 Running database migrations..."
	cd backend && . venv/bin/activate && python scripts/run_migrations.py

db-reset:
	@echo "⚠️  WARNING: This will delete all data!"
	@read -p "Are you sure? (yes/no): " confirm && [ "$$confirm" = "yes" ] || exit 1
	docker-compose -f infra/docker-compose.yml down -v
	docker-compose -f infra/docker-compose.yml up -d
	@sleep 3
	@$(MAKE) db-migrate
	@echo "✅ Database reset complete"

test:
	@echo "🧪 Running tests..."
	cd backend && . venv/bin/activate && pytest tests/
	cd frontend && npm run test

clean:
	@echo "🧹 Cleaning up..."
	docker-compose -f infra/docker-compose.yml down -v
	rm -rf backend/venv
	rm -rf backend/__pycache__
	rm -rf backend/**/__pycache__
	rm -rf frontend/.next
	rm -rf frontend/node_modules
	@echo "✅ Cleanup complete"

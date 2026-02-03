.PHONY: help migrate-latest db-status

help:
	@echo "Available commands:"
	@echo "  make migrate-latest  - Run the latest migration (0015)"
	@echo "  make db-status       - Check database status"

migrate-latest:
	@echo "Running migration 0015..."
	@cd backend && psql $$APP_DATABASE_URL -f database/migrations/0015_add_optimized_triage_fields.sql
	@echo "✅ Migration completed!"

db-status:
	@psql $$APP_DATABASE_URL -c "\d issue_categories"

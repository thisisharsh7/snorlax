#!/usr/bin/env python3
"""
Standalone script to run database migrations.
Can be run directly from the command line.
"""

import os
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from database.migrate import MigrationManager


def main():
    """Run database migrations."""
    # Load environment variables
    load_dotenv()

    database_url = os.getenv("APP_DATABASE_URL")
    if not database_url:
        print("Error: APP_DATABASE_URL environment variable not set")
        print("Please set it in your .env file or export it:")
        print("  export APP_DATABASE_URL='postgresql://user:pass@localhost:5432/dbname'")
        sys.exit(1)

    # Parse command line arguments
    command = sys.argv[1] if len(sys.argv) > 1 else "migrate"

    manager = MigrationManager(database_url)

    if command == "migrate":
        dry_run = "--dry-run" in sys.argv
        manager.run_migrations(dry_run=dry_run)

    elif command == "status":
        manager.migration_status()

    elif command == "create":
        if len(sys.argv) < 3:
            print("Usage: python run_migrations.py create <migration_name>")
            sys.exit(1)

        name = sys.argv[2]
        manager.create_migration(name)

    elif command == "help" or command == "--help" or command == "-h":
        print("Database Migration Tool")
        print("=" * 60)
        print("\nUsage:")
        print("  python scripts/run_migrations.py migrate [--dry-run]")
        print("    Apply all pending migrations to the database")
        print("    Use --dry-run to see what would be applied without making changes")
        print()
        print("  python scripts/run_migrations.py status")
        print("    Show current migration status")
        print()
        print("  python scripts/run_migrations.py create <name>")
        print("    Create a new migration file")
        print()
        print("Examples:")
        print("  python scripts/run_migrations.py migrate")
        print("  python scripts/run_migrations.py migrate --dry-run")
        print("  python scripts/run_migrations.py status")
        print("  python scripts/run_migrations.py create add_user_roles")

    else:
        print(f"Unknown command: {command}")
        print("Run 'python scripts/run_migrations.py help' for usage information")
        sys.exit(1)


if __name__ == "__main__":
    main()

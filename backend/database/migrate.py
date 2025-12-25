"""
Database migration management system.
Inspired by Drizzle ORM's migration approach, adapted for Python/PostgreSQL.
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any
import psycopg
from psycopg import sql
from datetime import datetime


class MigrationManager:
    """Manages database migrations with tracking and rollback support."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.migrations_dir = Path(__file__).parent / "migrations"
        self.meta_dir = self.migrations_dir / "meta"
        self.journal_file = self.meta_dir / "_journal.json"

    def _create_migrations_table(self, conn: psycopg.Connection) -> None:
        """Create the migrations tracking table if it doesn't exist."""
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS _migrations (
                    id SERIAL PRIMARY KEY,
                    idx INTEGER UNIQUE NOT NULL,
                    tag TEXT UNIQUE NOT NULL,
                    applied_at TIMESTAMP DEFAULT NOW(),
                    checksum TEXT,
                    execution_time_ms INTEGER
                );

                CREATE INDEX IF NOT EXISTS idx_migrations_idx ON _migrations(idx);
                CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON _migrations(applied_at DESC);
            """)
            conn.commit()

    def _get_applied_migrations(self, conn: psycopg.Connection) -> List[str]:
        """Get list of migration tags that have already been applied."""
        with conn.cursor() as cur:
            cur.execute("SELECT tag FROM _migrations ORDER BY idx")
            return [row[0] for row in cur.fetchall()]

    def _load_journal(self) -> Dict[str, Any]:
        """Load the migration journal from JSON file."""
        if not self.journal_file.exists():
            return {"version": "1", "dialect": "postgresql", "entries": []}

        with open(self.journal_file, 'r') as f:
            return json.load(f)

    def _get_pending_migrations(self, conn: psycopg.Connection) -> List[Dict[str, Any]]:
        """Get list of migrations that haven't been applied yet."""
        applied = set(self._get_applied_migrations(conn))
        journal = self._load_journal()

        pending = []
        for entry in journal["entries"]:
            if entry["tag"] not in applied:
                pending.append(entry)

        return sorted(pending, key=lambda x: x["idx"])

    def _read_migration_file(self, tag: str) -> str:
        """Read the SQL content of a migration file."""
        migration_file = self.migrations_dir / f"{tag}.sql"

        if not migration_file.exists():
            raise FileNotFoundError(f"Migration file not found: {migration_file}")

        with open(migration_file, 'r') as f:
            return f.read()

    def _apply_migration(self, conn: psycopg.Connection, entry: Dict[str, Any]) -> None:
        """Apply a single migration to the database."""
        tag = entry["tag"]
        idx = entry["idx"]

        print(f"[{idx:04d}] Applying migration: {tag}")

        # Read migration SQL
        sql_content = self._read_migration_file(tag)

        # Measure execution time
        start_time = datetime.now()

        try:
            with conn.cursor() as cur:
                # Execute the migration
                cur.execute(sql_content)

                # Calculate execution time
                execution_time = (datetime.now() - start_time).total_seconds() * 1000

                # Record the migration
                cur.execute("""
                    INSERT INTO _migrations (idx, tag, applied_at, execution_time_ms)
                    VALUES (%s, %s, NOW(), %s)
                """, (idx, tag, int(execution_time)))

                conn.commit()

                print(f"[{idx:04d}] ✓ Applied successfully ({int(execution_time)}ms)")

        except Exception as e:
            conn.rollback()
            print(f"[{idx:04d}] ✗ Failed to apply migration: {e}")
            raise

    def run_migrations(self, dry_run: bool = False) -> None:
        """
        Run all pending migrations.

        Args:
            dry_run: If True, only show what would be migrated without applying changes
        """
        print("=" * 60)
        print("Database Migration System")
        print("=" * 60)

        with psycopg.connect(self.database_url) as conn:
            # Ensure migrations table exists
            self._create_migrations_table(conn)

            # Get pending migrations
            pending = self._get_pending_migrations(conn)

            if not pending:
                print("\n✓ Database is up to date. No pending migrations.")
                return

            print(f"\nFound {len(pending)} pending migration(s):")
            for entry in pending:
                print(f"  [{entry['idx']:04d}] {entry['tag']}")

            if dry_run:
                print("\n(Dry run - no changes applied)")
                return

            print("\nApplying migrations...")
            print("-" * 60)

            for entry in pending:
                self._apply_migration(conn, entry)

            print("-" * 60)
            print(f"\n✓ Successfully applied {len(pending)} migration(s)")

    def migration_status(self) -> None:
        """Show the current migration status."""
        print("=" * 60)
        print("Migration Status")
        print("=" * 60)

        with psycopg.connect(self.database_url) as conn:
            self._create_migrations_table(conn)

            applied = set(self._get_applied_migrations(conn))
            journal = self._load_journal()

            total = len(journal["entries"])
            applied_count = len(applied)
            pending_count = total - applied_count

            print(f"\nTotal migrations: {total}")
            print(f"Applied: {applied_count}")
            print(f"Pending: {pending_count}")

            if journal["entries"]:
                print("\nMigrations:")
                for entry in journal["entries"]:
                    tag = entry["tag"]
                    idx = entry["idx"]
                    status = "✓" if tag in applied else "○"
                    print(f"  {status} [{idx:04d}] {tag}")

    def create_migration(self, name: str) -> None:
        """
        Create a new empty migration file with the given name.

        Args:
            name: Name for the migration (will be prefixed with index number)
        """
        journal = self._load_journal()

        # Get next index
        if journal["entries"]:
            next_idx = max(entry["idx"] for entry in journal["entries"]) + 1
        else:
            next_idx = 0

        # Create tag
        tag = f"{next_idx:04d}_{name}"

        # Create migration file
        migration_file = self.migrations_dir / f"{tag}.sql"

        with open(migration_file, 'w') as f:
            f.write(f"-- Migration: {name}\n")
            f.write(f"-- Created at: {datetime.now().isoformat()}\n\n")
            f.write("-- Add your SQL migration here\n\n")

        # Update journal
        new_entry = {
            "idx": next_idx,
            "version": "1",
            "when": int(datetime.now().timestamp() * 1000),
            "tag": tag,
            "breakpoints": True
        }

        journal["entries"].append(new_entry)

        with open(self.journal_file, 'w') as f:
            json.dump(journal, f, indent=2)

        print(f"✓ Created migration: {migration_file}")
        print(f"  Index: {next_idx}")
        print(f"  Tag: {tag}")


def run_migrations(database_url: str = None, dry_run: bool = False) -> None:
    """
    Convenience function to run migrations.

    Args:
        database_url: Database connection URL (defaults to APP_DATABASE_URL env var)
        dry_run: If True, only show what would be migrated
    """
    if database_url is None:
        database_url = os.getenv("APP_DATABASE_URL")
        if not database_url:
            raise ValueError("Database URL not provided and APP_DATABASE_URL not set")

    manager = MigrationManager(database_url)
    manager.run_migrations(dry_run=dry_run)


if __name__ == "__main__":
    import sys

    # Simple CLI interface
    command = sys.argv[1] if len(sys.argv) > 1 else "migrate"

    database_url = os.getenv("APP_DATABASE_URL")
    if not database_url:
        print("Error: APP_DATABASE_URL environment variable not set")
        sys.exit(1)

    manager = MigrationManager(database_url)

    if command == "migrate":
        dry_run = "--dry-run" in sys.argv
        manager.run_migrations(dry_run=dry_run)

    elif command == "status":
        manager.migration_status()

    elif command == "create":
        if len(sys.argv) < 3:
            print("Usage: python migrate.py create <migration_name>")
            sys.exit(1)

        name = sys.argv[2]
        manager.create_migration(name)

    else:
        print("Usage:")
        print("  python migrate.py migrate [--dry-run]  # Apply pending migrations")
        print("  python migrate.py status                # Show migration status")
        print("  python migrate.py create <name>         # Create new migration")
        sys.exit(1)

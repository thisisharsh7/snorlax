#!/usr/bin/env python3
"""
Database cleanup script for development environments.
WARNING: This will drop all tables! Only use in development.
"""

import os
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
import psycopg


def clean_database(database_url: str, force: bool = False) -> None:
    """
    Drop all tables, functions, and the migrations table.

    Args:
        database_url: Database connection URL
        force: Skip confirmation prompt
    """
    # Safety check - don't run on production
    if 'prod' in database_url.lower() or 'production' in database_url.lower():
        print("❌ ERROR: This script cannot be run on production databases!")
        print(f"   Database URL contains 'prod' or 'production': {database_url}")
        sys.exit(1)

    if not force:
        print("⚠️  WARNING: This will DROP ALL TABLES in the database!")
        print(f"   Database: {database_url.split('@')[1] if '@' in database_url else database_url}")
        response = input("\n   Are you sure? Type 'yes' to continue: ")

        if response.lower() != 'yes':
            print("Cancelled.")
            return

    print("\n" + "=" * 60)
    print("Cleaning Database")
    print("=" * 60)

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            # Drop all tables in public schema
            print("\n1. Dropping all tables...")
            cur.execute("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
            """)

            tables = [row[0] for row in cur.fetchall()]

            if tables:
                print(f"   Found {len(tables)} table(s)")
                for table in tables:
                    print(f"   - Dropping table: {table}")
                    cur.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            else:
                print("   No tables found")

            # Drop all custom types/enums
            print("\n2. Dropping all custom types...")
            cur.execute("""
                SELECT typname
                FROM pg_type
                WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
                AND typtype = 'e'
            """)

            types = [row[0] for row in cur.fetchall()]

            if types:
                print(f"   Found {len(types)} custom type(s)")
                for type_name in types:
                    print(f"   - Dropping type: {type_name}")
                    cur.execute(f"DROP TYPE IF EXISTS {type_name} CASCADE")
            else:
                print("   No custom types found")

            # Drop all functions
            print("\n3. Dropping all functions...")
            cur.execute("""
                SELECT proname, oidvectortypes(proargtypes)
                FROM pg_proc
                WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            """)

            functions = cur.fetchall()

            if functions:
                print(f"   Found {len(functions)} function(s)")
                for func_name, arg_types in functions:
                    print(f"   - Dropping function: {func_name}")
                    cur.execute(f"DROP FUNCTION IF EXISTS {func_name}({arg_types}) CASCADE")
            else:
                print("   No functions found")

            conn.commit()

            print("\n" + "-" * 60)
            print("✓ Database cleaned successfully")
            print("  All tables, types, and functions have been dropped")
            print("  Run migrations to recreate the schema:")
            print("    python scripts/run_migrations.py migrate")
            print("=" * 60)


def main():
    """Main entry point."""
    load_dotenv()

    database_url = os.getenv("APP_DATABASE_URL")
    if not database_url:
        print("Error: APP_DATABASE_URL environment variable not set")
        sys.exit(1)

    force = "--force" in sys.argv or "-f" in sys.argv

    try:
        clean_database(database_url, force=force)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

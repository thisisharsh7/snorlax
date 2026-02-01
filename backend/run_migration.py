"""Quick script to run the caching tables migration."""
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.database import get_db_connection

def run_migration():
    """Run migration 0014 - caching tables."""
    print("🚀 Running migration 0014: Triage optimization caching...")

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Read migration file
        migration_file = 'database/migrations/0014_triage_optimization_caching.sql'
        with open(migration_file, 'r') as f:
            migration_sql = f.read()

        # Execute migration
        cur.execute(migration_sql)
        conn.commit()

        print("✅ Migration executed successfully!")

        # Verify tables
        cur.execute("""
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename IN ('internet_search_cache', 'claude_response_cache', 'api_costs')
            ORDER BY tablename
        """)

        tables = cur.fetchall()
        if tables:
            print(f"✅ Created {len(tables)} tables:")
            for table in tables:
                print(f"   - {table[0]}")
        else:
            print("⚠️  Tables may already exist or weren't created")

        # Check functions
        cur.execute("""
            SELECT routine_name
            FROM information_schema.routines
            WHERE routine_schema = 'public'
              AND routine_name IN ('cleanup_expired_cache', 'track_api_cost')
        """)

        functions = cur.fetchall()
        if functions:
            print(f"✅ Created {len(functions)} functions:")
            for func in functions:
                print(f"   - {func[0]}()")

        print("\n🎉 Migration complete!")
        print("\nYou can now:")
        print("  1. View cost savings: SELECT * FROM cost_analysis;")
        print("  2. Check cache: SELECT COUNT(*) FROM claude_response_cache;")
        print("  3. Track costs: SELECT * FROM api_costs ORDER BY date DESC;")

    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    run_migration()

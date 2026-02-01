#!/usr/bin/env python3
"""
Fix migration idx=13 duplicate key error.

This script:
1. Deletes the old migration entry for idx=13 (0013_repository_sync_tracking)
2. Allows the new migration (0014_triage_optimization_caching) to use idx=13
"""

import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.database import get_db_connection

def fix_migration():
    """Remove the old idx=13 entry to allow new migration to proceed."""
    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Check what's in idx=13
        cur.execute("SELECT idx, tag, checksum, applied_at FROM _migrations WHERE idx = 13")
        existing = cur.fetchone()

        if existing:
            print(f"Found existing migration at idx=13:")
            print(f"  Tag: {existing[1]}")
            print(f"  Checksum: {existing[2]}")
            print(f"  Applied: {existing[3]}")

            # Delete it
            cur.execute("DELETE FROM _migrations WHERE idx = 13")
            conn.commit()
            print(f"\n✅ Deleted old migration entry for idx=13")
            print(f"You can now run the migration with: python run_migration.py")
        else:
            print("No migration found at idx=13. Migration should be ready to run.")

        # Show current migration status
        cur.execute("SELECT idx, tag FROM _migrations ORDER BY idx DESC LIMIT 5")
        recent = cur.fetchall()
        print(f"\nRecent migrations:")
        for row in recent:
            print(f"  idx={row[0]}: {row[1]}")

    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        import traceback
        traceback.print_exc()
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    print("🔧 Fixing migration duplicate key error...\n")
    fix_migration()

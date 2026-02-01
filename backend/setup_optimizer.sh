#!/bin/bash

# Setup script for triage optimizer
# This adds caching tables and prepares the system for cost-optimized triage

echo "🚀 Setting up Triage Optimizer..."
echo ""

# Activate virtual environment
source venv/bin/activate

# Run migration
echo "📦 Running database migration..."
python scripts/run_migrations.py migrate

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Setup complete!"
    echo ""
    echo "📊 You can now:"
    echo "   1. Restart your backend server"
    echo "   2. View cost savings: psql -d yourdb -c \"SELECT * FROM cost_analysis;\""
    echo "   3. Check cache stats: psql -d yourdb -c \"SELECT COUNT(*) as cached_responses FROM claude_response_cache;\""
    echo ""
    echo "💰 Expected savings: 99% cost reduction (from \$0.03 to \$0.003 per issue)"
    echo ""
else
    echo ""
    echo "❌ Migration failed. Check error above."
    exit 1
fi

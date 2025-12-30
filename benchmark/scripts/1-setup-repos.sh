#!/bin/bash
set -euo pipefail

echo "🔧 Setting up benchmark repositories..."

# Get absolute path to benchmark root
BENCHMARK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOS_DIR="$BENCHMARK_ROOT/repos"

echo "Benchmark root: $BENCHMARK_ROOT"
echo "Repos directory: $REPOS_DIR"

# Clone RepoBench-R top 2 repos
if [ ! -d "$REPOS_DIR/ciscoconfparse2" ]; then
  echo "📥 Cloning ciscoconfparse2..."
  git clone https://github.com/mpenning/ciscoconfparse2 "$REPOS_DIR/ciscoconfparse2"
else
  echo "✓ ciscoconfparse2 already cloned"
fi

if [ ! -d "$REPOS_DIR/aitviewer-skel" ]; then
  echo "📥 Cloning aitviewer-skel..."
  git clone https://github.com/MarilynKeller/aitviewer-skel "$REPOS_DIR/aitviewer-skel"
else
  echo "✓ aitviewer-skel already cloned"
fi

# Index with sensegrep
echo ""
echo "📊 Indexing with sensegrep..."

cd "$REPOS_DIR/ciscoconfparse2"
echo "Indexing ciscoconfparse2..."
npx sensegrep index --full
cd -

cd "$REPOS_DIR/aitviewer-skel"
echo "Indexing aitviewer-skel..."
npx sensegrep index --full
cd -

# Show stats
echo ""
echo "✅ Setup complete! Index statistics:"
echo ""
echo "━━━ ciscoconfparse2 ━━━"
npx sensegrep stats --root "$REPOS_DIR/ciscoconfparse2"
echo ""
echo "━━━ aitviewer-skel ━━━"
npx sensegrep stats --root "$REPOS_DIR/aitviewer-skel"

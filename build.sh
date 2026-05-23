#!/usr/bin/env bash
# Build the Bronkit .mcpb bundle from a clean checkout.
# Installs the server's npm dependencies, then packages the bundle into dist/.
set -euo pipefail

# Resolve the repo root (this script's own directory) so the build runs from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NAME="bronkit.mcpb"
DIST="$ROOT/dist"

echo "==> Installing server dependencies"
( cd server && npm install )

echo "==> Assembling $NAME"
mkdir -p "$DIST"
rm -f "$DIST/$NAME"
zip -r -q "$DIST/$NAME" manifest.json server/ skills/ .claude-plugin/

echo "==> Built $DIST/$NAME ($(du -h "$DIST/$NAME" | cut -f1))"

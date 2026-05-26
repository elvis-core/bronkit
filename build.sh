#!/usr/bin/env bash
# Build the Bronkit .mcpb bundle. Pure Node — no native binary.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

NAME="bronkit.mcpb"
DIST="$ROOT/dist"

echo "==> Installing production dependencies"
npm install --omit=dev --no-audit --no-fund

echo "==> Assembling $NAME"
mkdir -p "$DIST"
rm -f "$DIST/$NAME"
# Bundle only what the server needs at runtime (no tests, no scripts, no dev cruft).
zip -r -q "$DIST/$NAME" manifest.json package.json icon.png src/ config/ node_modules/ -x "*.DS_Store"

echo "==> Built $DIST/$NAME ($(du -h "$DIST/$NAME" | cut -f1))"

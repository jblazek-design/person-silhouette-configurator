#!/usr/bin/env bash
# Mirrors the Figma export folder ("Characters factory" on the Desktop) into
# socialmind/assets/parts/ and rebuilds socialmind/parts.js.
# Usage: scripts/sync-socialmind-assets.sh [source-dir]
set -euo pipefail
SRC="${1:-$HOME/Desktop/Characters factory}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="$ROOT/socialmind/assets/parts"
[ -d "$SRC" ] || { echo "source folder not found: $SRC" >&2; exit 1; }
sync() { mkdir -p "$DST/$2"; rsync -a --delete --exclude .DS_Store "$SRC/$1/" "$DST/$2/"; }
sync "Base/Shape 1" base/shape-1
sync "Base/Shape 2" base/shape-2
sync "Base/Shape 3" base/shape-3
sync Legs legs
sync Eyes eyes
sync Arms arms
sync Hats hats
sync Pets pets
node "$ROOT/scripts/build-socialmind-parts.js"

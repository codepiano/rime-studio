#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
node scripts/check-toolchain.mjs
corepack pnpm install --frozen-lockfile
exec corepack pnpm run build

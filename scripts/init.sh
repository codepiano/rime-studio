#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
node -e "if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或以上')"
mkdir -p .runtime .data

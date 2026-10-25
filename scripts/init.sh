#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if (major<22 || (major===22 && minor<12)) throw new Error('需要 Node.js 22.12 或以上')"
mkdir -p .runtime .data

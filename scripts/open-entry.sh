#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
"$project_root/scripts/release-start.sh"
exec node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const { frontendUrl } = JSON.parse(fs.readFileSync('control-panel.json', 'utf8'));
const opened = spawnSync('open', [frontendUrl], { stdio: 'inherit' });
if (opened.error || opened.status !== 0) {
  console.error('无法打开浏览器：' + (opened.error?.message || `退出码 ${opened.status}`));
  process.exitCode = 1;
}
NODE

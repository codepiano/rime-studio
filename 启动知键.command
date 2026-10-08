#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="${0:A:h}"
cd "$project_root"
./scripts/init.sh
if [[ ! -d node_modules ]]; then ./scripts/install.sh; fi
exec ./scripts/open-entry.sh

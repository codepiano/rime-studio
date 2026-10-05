#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_root="${0:A:h}"
cd "$project_root"
if curl --silent --fail --max-time 2 http://127.0.0.1:4319/health | python3 -c 'import json,sys; assert json.load(sys.stdin).get("service")=="rime-studio"' 2>/dev/null; then
  open http://127.0.0.1:4319
  exit 0
fi
if ! command -v node >/dev/null; then
  print '需要先安装 Node.js，才能启动本地工作台。'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
mkdir -p .data
nohup node server.js > .data/server.log 2>&1 &
print $! > .data/server.pid
for attempt in {1..20}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:4319/health | python3 -c 'import json,sys; assert json.load(sys.stdin).get("service")=="rime-studio"' 2>/dev/null; then
    open http://127.0.0.1:4319
    exit 0
  fi
  sleep 0.3
done
print '服务未能启动。请查看 .data/server.log；可能已有其他程序占用 4319 端口。'
exit 1

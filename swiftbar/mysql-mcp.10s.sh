#!/bin/bash
# <bitbar.title>mysql-mcp 프로파일 게이트</bitbar.title>
# <bitbar.desc>MCP 가 붙을 수 있는 DB 프로파일을 열고 닫는다</bitbar.desc>
# <bitbar.dependencies>node</bitbar.dependencies>
#
# 알맹이는 같은 폴더의 menu.mjs 다. 이 파일은 node 를 찾아 넘기는 일만 한다.
# SwiftBar 는 로그인 셸을 거치지 않아 PATH 가 좁고, node 가 nvm 같은 곳에만
# 있으면 셔뱅(#!/usr/bin/env node)으로는 못 찾기 때문이다.
set -uo pipefail

# 심링크로 걸려 있어도 원본 폴더를 찾는다.
src="${BASH_SOURCE[0]}"
while [ -L "$src" ]; do
  dir="$(cd -P "$(dirname "$src")" && pwd)"
  src="$(readlink "$src")"
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
HERE="$(cd -P "$(dirname "$src")" && pwd)"

find_node() {
  command -v node 2>/dev/null && return 0
  for candidate in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  local latest
  latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$latest" ] && [ -x "$HOME/.nvm/versions/node/$latest/bin/node" ]; then
    printf '%s\n' "$HOME/.nvm/versions/node/$latest/bin/node"
    return 0
  fi
  return 1
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  echo "⚠️"
  echo "---"
  echo "node 를 찾지 못했습니다. SwiftBar 설정에서 PATH 를 넓히거나 node 를 표준 경로에 두세요."
  exit 0
fi

exec "$NODE" "$HERE/menu.mjs" "$@"

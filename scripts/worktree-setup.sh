#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

if [[ "$main" != "$PWD" ]]; then
  mkdir -p data
  for d in dem kernels validation horizon_cache; do
    if [[ ! -e "$main/data/$d" ]]; then
      echo "skip data/$d: not present in $main/data" >&2
    elif [[ -e "data/$d" && ! -L "data/$d" ]]; then
      echo "skip data/$d: a real directory already exists here" >&2
    else
      ln -sfn "$main/data/$d" "data/$d"
    fi
  done
fi

uv sync --frozen
(cd web && bun install --frozen-lockfile)

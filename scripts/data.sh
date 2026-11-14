#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bucket="${LUNARNAV_BUCKET:-gs://lunarnav-1114-19887-data}"
data="${LUNARNAV_DATA:-$PWD/data}"
starter=(lola_global_64ppd lola_60s_240m lola_60n_240m)
regional=(
  "18.5623 61.8103 ldem_512"
  "-13.316 25.251 ldem_512"
  "-69.373 32.319 ldem_512"
  "18.5623 61.8103 sldem2015_512"
  "-13.316 25.251 sldem2015_512"
  "-41.639 206.015 sldem2015_512"
  "-45.4561 177.5885 sldem2015_512"
)

usage() {
  cat <<USAGE
usage: scripts/data.sh <command> [dem_id ...]

  list                 terrain stores in the bucket, with sizes
  pull                 kernels plus a starter set of stores (~3.5 GB): ${starter[*]} and the regional windows
  pull --all           everything in the bucket (~52 GB)
  pull <dem_id> ...    kernels plus the named stores
  build <dem_id> ...   download the source product from NASA and build the store locally
  build --all          rebuild every store from NASA: products, uncertainty layers, regional windows
USAGE
}

need_gcloud() {
  command -v gcloud >/dev/null || { echo "gcloud is not installed: https://cloud.google.com/sdk/docs/install" >&2; exit 1; }
  export CLOUDSDK_AUTH_DISABLE_CREDENTIALS=True
}

sync_down() {
  mkdir -p "$data/$2"
  gcloud storage rsync -r "$bucket/$1" "$data/$2"
}

regional_ids() {
  gcloud storage ls "$bucket/dem/store/" | sed -n 's#.*/dem/store/\(\(ldem\|sldem2015\)_512_[^/]*\)/$#\1#p'
}

cmd="${1:-}"
[[ -n "$cmd" ]] && shift
case "$cmd" in
  list)
    need_gcloud
    gcloud storage du "$bucket/dem/store/" | awk -v p="$bucket/dem/store/" '
      index($2, p) == 1 && length($2) > length(p) { split(substr($2, length(p) + 1), part, "/"); size[part[1]] += $1 }
      END { for (id in size) printf "%8.2f GB  %s\n", size[id] / 1e9, id }' | sort -k3
    ;;
  pull)
    need_gcloud
    sync_down kernels kernels
    if [[ "${1:-}" == "--all" ]]; then
      for dir in validation horizon_cache dem/store; do sync_down "$dir" "$dir"; done
    else
      ids=("$@")
      ((${#ids[@]})) || mapfile -t ids < <(printf '%s\n' "${starter[@]}"; regional_ids)
      for id in "${ids[@]}"; do sync_down "dem/store/$id" "dem/store/$id"; done
    fi
    ;;
  build)
    (($#)) || { usage; exit 2; }
    export LUNARNAV_DATA="$data"
    if [[ "$1" == "--all" ]]; then
      uv run lunarnav kernels
      uv run python -m lunarnav.terrain.ingest fetch --all
      uv run python -m lunarnav.terrain.ingest build --all
      uv run python -m lunarnav.terrain.ingest build-err --all
      for window in "${regional[@]}"; do
        read -r lat lon product <<<"$window"
        uv run python -m lunarnav.terrain.regional --lat "$lat" --lon "$lon" --product "$product"
      done
    else
      for id in "$@"; do
        uv run python -m lunarnav.terrain.ingest fetch "$id"
        uv run python -m lunarnav.terrain.ingest build "$id"
      done
    fi
    ;;
  *)
    usage
    [[ -z "$cmd" || "$cmd" == "-h" || "$cmd" == "--help" ]] || exit 2
    ;;
esac

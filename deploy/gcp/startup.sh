#!/usr/bin/env bash
set -euo pipefail

meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }

project="$(meta project/project-id)"
image="$(meta instance/attributes/lunarnav-image)"
bucket="$(meta instance/attributes/lunarnav-bucket)"
disk=/dev/disk/by-id/google-data
mnt=/mnt/data

if ! blkid "$disk" >/dev/null 2>&1; then
  mkfs.ext4 -q -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$disk"
fi
mkdir -p "$mnt"
mountpoint -q "$mnt" || mount -o discard,defaults "$disk" "$mnt"
grep -q " $mnt " /etc/fstab || echo "UUID=$(blkid -s UUID -o value "$disk") $mnt ext4 discard,defaults,nofail 0 2" >> /etc/fstab

if ! command -v docker >/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io
fi
systemctl enable --now docker
if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0
fi
gcloud auth configure-docker "${image%%/*}" --quiet

gcloud storage rsync -r --no-user-output-enabled "gs://$bucket" "$mnt"
mkdir -p "$mnt/service" "$mnt/runs" "$mnt/numba-cache"
chown -R 1000:1000 "$mnt"

install -m 755 /dev/stdin /usr/local/bin/lunarnav-update <<'UPDATE'
#!/usr/bin/env bash
set -euo pipefail

meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
image="$(meta instance/attributes/lunarnav-image)"
bucket="$(meta instance/attributes/lunarnav-bucket)"
origin="$(meta instance/attributes/lunarnav-origin)"
workers="$(meta instance/attributes/lunarnav-workers)"
state=/var/lib/lunarnav
mkdir -p "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

healthy() {
  local deadline=$((SECONDS + 300))
  while ((SECONDS < deadline)); do
    if curl -fsS -m 5 -H 'Host: localhost' http://127.0.0.1:8100/api/v1/health 2>/dev/null | grep -q '"warm":true'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

secret() { gcloud secrets versions access latest --secret="$1" 2>/dev/null || true; }

start() {
  local agent=()
  local key codes
  key="$(secret anthropic-api-key)"
  codes="$(secret agent-codes | tr -s ' \n' ',' | sed 's/^,//; s/,$//')"
  rm -rf /mnt/data/agent-key
  if [[ -n "$key" && -n "$codes" ]]; then
    install -d -m 700 -o 1000 -g 1000 /mnt/data/agent-key /mnt/data/home
    install -m 600 -o 1000 -g 1000 /dev/null /mnt/data/agent-key/key
    printf '%s' "$key" > /mnt/data/agent-key/key
    printf 'cli_env_keep: [LUNARNAV_DATA]\nruns_root: /data/runs\n' > /mnt/data/agent.yaml
    chown 1000:1000 /mnt/data/agent.yaml
    agent=(
      --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined
      -e HOME=/data/home
      -e LUNARNAV_API_AGENT_ENABLED=1
      -e LUNARNAV_API_AGENT_CODES="$codes"
      -e LUNARNAV_AGENT_API_KEY_FILE=/data/agent-key/key
      -e LUNARNAV_AGENT_CONFIG=/data/agent.yaml
    )
  fi
  docker rm -f lunarnav >/dev/null 2>&1 || true
  docker run -d --name lunarnav --restart unless-stopped --network host \
    -v /mnt/data:/data \
    -e LUNARNAV_API_CORS_ORIGINS="$origin" \
    -e LUNARNAV_API_JOB_WORKERS="$workers" \
    "${agent[@]}" \
    "$1" >/dev/null
}

generation="$(gcloud storage objects describe "gs://$bucket/manifest.json" --format='value(generation)' 2>/dev/null || true)"
if [[ -n "$generation" && "$generation" != "$(cat "$state/data-generation" 2>/dev/null || true)" ]]; then
  if [[ -f "$state/data-generation" ]]; then
    log "syncing data for manifest generation $generation"
    gcloud storage rsync -r --no-user-output-enabled "gs://$bucket/dem/store" /mnt/data/dem/store
    gcloud storage rsync -r --no-user-output-enabled "gs://$bucket/kernels" /mnt/data/kernels
    chown -R 1000:1000 /mnt/data/dem /mnt/data/kernels
    if docker inspect lunarnav >/dev/null 2>&1; then
      docker restart lunarnav >/dev/null
      if healthy; then log "restarted on the new data"; else log "the API is not healthy after the data sync"; fi
    fi
  fi
  echo "$generation" > "$state/data-generation"
fi

docker pull -q "$image" >/dev/null
new="$(docker image inspect -f '{{.Id}}' "$image")"
current="$(docker inspect -f '{{.Image}}' lunarnav 2>/dev/null || true)"
[[ "$new" == "$current" ]] && exit 0
[[ "$new" == "$(cat "$state/failed" 2>/dev/null || true)" ]] && exit 0

log "deploying $new"
start "$new"
if healthy; then
  rm -f "$state/failed"
  docker image prune -f >/dev/null
  log "deployed $new"
  exit 0
fi

echo "$new" > "$state/failed"
log "$new did not become healthy"
if [[ -n "$current" ]]; then
  start "$current"
  healthy && log "rolled back to $current"
fi
exit 1
UPDATE

cat > /etc/systemd/system/lunarnav-update.service <<'UNIT'
[Unit]
Description=Deploy the newest lunarnav image
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/lunarnav-update
TimeoutStartSec=15min
UNIT

cat > /etc/systemd/system/lunarnav-update.timer <<'UNIT'
[Unit]
Description=Check for a new lunarnav image every minute

[Timer]
OnBootSec=10s
OnUnitInactiveSec=1min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl start lunarnav-update.service || true
systemctl enable --now lunarnav-update.timer

if [[ "$(docker inspect -f '{{.State.Running}}' cloudflared 2>/dev/null || true)" != true ]]; then
  token="$(gcloud secrets versions access latest --secret=tunnel-token --project "$project")"
  docker rm -f cloudflared >/dev/null 2>&1 || true
  docker run -d --name cloudflared --restart unless-stopped --network host \
    -e TUNNEL_TOKEN="$token" \
    cloudflare/cloudflared:2026.9.3 tunnel --no-autoupdate --protocol quic run
fi

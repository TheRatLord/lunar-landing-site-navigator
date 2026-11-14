#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
with_sudo=1
[[ "${1:-}" == "--no-sudo" ]] && with_sudo=0

if (( with_sudo )); then
  sudo apt-get update
  sudo apt-get install -y bubblewrap socat util-linux apparmor curl unzip \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 libfontconfig1

  sudo tee /etc/apparmor.d/bwrap-lunarnav >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap-lunarnav /usr/bin/bwrap flags=(unconfined) {
  userns,

  include if exists <local/bwrap-lunarnav>
}
EOF
  sudo apparmor_parser -r /etc/apparmor.d/bwrap-lunarnav

  if [[ -e /etc/apparmor.d/bwrap-userns-restrict ]]; then
    echo "Found /etc/apparmor.d/bwrap-userns-restrict: the agent sandbox will not work while it is loaded." >&2
    echo "To remove it: sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict && sudo rm /etc/apparmor.d/bwrap-userns-restrict" >&2
  fi
fi

command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

uv sync
(cd web && bun install --frozen-lockfile && bun run build)

.venv/bin/python -c "from lunarnav.ephem import load_kernels; ks = load_kernels(); print(ks)"

if (( with_sudo )); then
  .venv/bin/python -m lunarnav.agent sandbox-check || {
    echo "Agent sandbox check failed: the code agent will refuse to start." >&2
  }
fi

echo "Bootstrap complete. Terrain is a separate download."

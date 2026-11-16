# Deployment

Moonwalker is live at https://moonwalker.cinne.dev and runs on Google Cloud (project `lunarnav-1114-19887`, VM `lunarnav` in `us-central1-a`).

- **Every push to `main` deploys automatically**, usually within about 10 minutes:
  1. The `images` workflow builds the Docker image (the API plus the built UI) and pushes it to Artifact Registry as `:latest` and `:main-<sha7>-<commit time>`. GitHub signs in to Google Cloud with Workload Identity Federation, which accepts only `main` of this repository, so no keys are stored in GitHub.
  2. Every minute the VM pulls `:latest`. When the image has changed, it replaces the container and waits for `/api/v1/health` to report warm.
- **A broken change doesn't take the site down.** A build failure (`bun run build` includes the typecheck; Python installs with `uv sync --frozen`) pushes no image. An image that doesn't become healthy within 5 minutes is rolled back and skipped until a newer one arrives. Each deploy restarts the API, so expect about a minute of downtime.
- **Results are recomputed after a deploy.** A deploy that changes the Python package empties the result cache. The service keeps the requests it has served, with how often, under `/mnt/data/service/replay`; requests sent while the demo plan is open carry an `X-Lunarnav-Demo: 1` header and are marked as demo requests. Once the workers are warm it recomputes 96 requests, one at a time and only while no visitor's job is running: first the 32 demo requests used most recently, so requests from an older interface or an older demo date drop out of those places, then the most requested of the rest. Within each group the short analyses run before the long ones. The demo plan's pages answer from the cache again a few minutes after a deploy. When the list is full (512 requests), the 32 most recently used demo requests are never the ones dropped. Exports and regional layers are left out.
- **Dependencies:** keep `uv.lock` and `web/bun.lock` committed and current.
- **Terrain data** is rebuilt by the `data` workflow (Actions tab, run it on `main` with `all` or the store ids). It runs `scripts/data.sh build` in Cloud Build (`deploy/gcp/data-build.yaml`; about 20 minutes for everything, about 2 for one store), publishes the stores to `gs://lunarnav-1114-19887-data`, and writes `manifest.json` last. Every minute the VM's updater checks that manifest; when it changes, the VM syncs the stores and restarts the API. Only the Cloud Build service account can write to the bucket.
- **The AI assistant is open to every visitor, with no login**, until its shared spend cap is used up (see [The assistant](#the-assistant)). It stays off until its API key secret exists.

## How requests flow

`moonwalker.cinne.dev` is served by the Cloudflare Worker in `deploy/worker`. The former addresses, `moonwalkr.cinne.dev` and `lunar.cinne.dev`, are further domains of the same Worker, which answers them with a permanent redirect (308) to the same path on `moonwalker.cinne.dev`. The Worker forwards every other request through a Workers VPC binding to the `lunarnav` Cloudflare Tunnel, whose connector runs on the VM. It also caches the hashed `/assets/*` files at Cloudflare's edge. The API listens on `127.0.0.1:8100` on the VM. The VM accepts no inbound traffic except SSH through IAP. The API changes state only for browser pages whose origin is listed in the VM's `lunarnav-origin` metadata (comma separated; it holds all three addresses), which the updater reads each time it starts the container. The Worker only changes when `deploy/worker` changes; deploy it with `bunx cf deploy` from that directory.

## The VM

`deploy/gcp/startup.sh` is the VM's startup script and runs on every boot. It:
- mounts the `lunarnav-data` disk at `/mnt/data` and syncs the data from `gs://lunarnav-1114-19887-data` (terrain stores, kernels, validation data, horizon cache);
- installs the `lunarnav-update` timer, which deploys new images and new data, and runs it once;
- starts `cloudflared` with the tunnel token from Secret Manager (`tunnel-token`) if it isn't already running.

| Task | Command |
| --- | --- |
| Shell | `gcloud compute ssh lunarnav --zone us-central1-a --project lunarnav-1114-19887 --tunnel-through-iap` |
| Deploy log | `journalctl -u lunarnav-update -f` |
| API log | `sudo docker logs -f lunarnav` |
| Deploy now | `sudo systemctl start lunarnav-update` |
| Re-run the startup script (after changing it) | `gcloud compute instances add-metadata lunarnav --zone us-central1-a --project lunarnav-1114-19887 --metadata-from-file startup-script=deploy/gcp/startup.sh`, then on the VM: `sudo google_metadata_script_runner startup` |

## The assistant

The assistant runs only when Secret Manager holds `anthropic-api-key`, the API key it bills to:

```sh
printf '%s' 'sk-ant-...' | gcloud secrets create anthropic-api-key --data-file=- --project lunarnav-1114-19887
```

Anyone who opens the site can use it; there is no code or login. The first request gives the browser a random cookie, and a browser sees only the threads started with its own cookie.

The service stops starting or continuing threads once all threads together have cost 60 USD (instance metadata `lunarnav-agent-budget` changes the amount). Each new thread's cap is cut to what is left, so the total can overshoot only by what threads already running spend in their current turn. From then on the Ask panel says that the assistant's credit is used up; raise the metadata value and restart the container to reopen it. The same message appears on a thread whose turn fails because the API key itself has no credit left.

Every visitor also sees one example thread, read-only. It is the newest thread started with the showcase token whose latest turn completed, whose SHA-256 is `SHOWCASE_OWNER_SHA256` in `src/lunarnav/api/settings.py`. To replace the example, send the token as the `lunarnav_agent_code` cookie and start a thread:

```sh
curl -X POST https://moonwalker.cinne.dev/api/v1/agent/runs -H 'Origin: https://moonwalker.cinne.dev' -H 'Content-Type: application/json' \
  -b "lunarnav_agent_code=$(cat ~/.moonwalker-showcase-token)" -d '{"prompt": "...", "budget_usd": 4}'
```

The VM's service account needs `roles/secretmanager.secretAccessor` on the secret. The updater reads it each time it starts the container. To apply a change without a new image, on the VM run `sudo docker rm -f lunarnav && sudo systemctl start lunarnav-update`. Removing the secret turns the assistant off again at the next start.

When the secret is present, the container runs with `seccomp`, `apparmor` and `systempaths` unconfined, so that bubblewrap can create the nested namespaces the Bash sandbox needs. The startup script also allows unprivileged user namespaces where the kernel has the AppArmor switch. It also blocks uid 1000, which the container runs as, from the metadata server (`169.254.169.254`), so code the assistant runs can never get the VM's service-account token. Port 53 of that address stays open, because it is also the VM's DNS resolver and the assistant needs it to reach the API. The key is written to `/mnt/data/agent-key/key`, and the CLI reads it through its `apiKeyHelper` setting. It is never in an environment variable, and the Bash sandbox can't read that directory. After the first start, check the sandbox on the VM with `sudo docker exec lunarnav lunarnav agent sandbox-check`. Every probe must pass, including "API key hidden".

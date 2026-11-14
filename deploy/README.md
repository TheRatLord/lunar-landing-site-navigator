# Deployment

The app is live at https://lunar.cinne.dev and runs on Google Cloud (project `lunarnav-1114-19887`, VM `lunarnav` in `us-central1-a`).

- **Every push to `main` deploys automatically**, usually within about 10 minutes:
  1. The `images` workflow builds the Docker image (the API plus the built UI) and pushes it to Artifact Registry as `:latest` and `:main-<sha7>-<commit time>`. GitHub signs in to Google Cloud with Workload Identity Federation, which accepts only `main` of this repository, so no keys are stored in GitHub.
  2. Every minute the VM pulls `:latest`. When the image has changed, it replaces the container and waits for `/api/v1/health` to report warm.
- **A broken change doesn't take the site down.** A build failure (`bun run build` includes the typecheck; Python installs with `uv sync --frozen`) pushes no image. An image that doesn't become healthy within 5 minutes is rolled back and skipped until a newer one arrives. Each deploy restarts the API, so expect about a minute of downtime.
- **Dependencies:** keep `uv.lock` and `web/bun.lock` committed and current.
- **Terrain data** is rebuilt by the `data` workflow (Actions tab, run it on `main` with `all` or the store ids). It runs `scripts/data.sh build` in Cloud Build (`deploy/gcp/data-build.yaml`; about 20 minutes for everything, about 2 for one store), publishes the stores to `gs://lunarnav-1114-19887-data`, and writes `manifest.json` last. Every minute the VM's updater checks that manifest; when it changes, the VM syncs the stores and restarts the API. Only the Cloud Build service account can write to the bucket.
- **The AI assistant is off** in the deployment.

## How requests flow

`lunar.cinne.dev` is served by the Cloudflare Worker in `deploy/worker`. It forwards every request through a Workers VPC binding to the `lunarnav` Cloudflare Tunnel, whose connector runs on the VM. It also caches the hashed `/assets/*` files at Cloudflare's edge. The API listens on `127.0.0.1:8100` on the VM. The VM accepts no inbound traffic except SSH through IAP. The Worker only changes when `deploy/worker` changes; deploy it with `bunx cf deploy` from that directory.

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

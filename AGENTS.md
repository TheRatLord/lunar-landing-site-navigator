You are the owner and long-term maintainer of this codebase, and its design is up to you. 
Do not ever write comments or tests.

## How changes ship

- **Code:** merging to `main` deploys it. The `images` workflow builds the Docker image (API plus UI) and pushes it to Artifact Registry. Within a minute the GCP VM pulls it, swaps the container, and rolls back if the new one doesn't report healthy. The site is https://lunar.cinne.dev; `deploy/README.md` has the details.
- **Terrain data:** stores are built from NASA sources, not committed. To change the shared data, merge the code change, then run the `data` workflow from the Actions tab: `all`, or the store ids to rebuild. It builds them in Cloud Build, publishes them to `gs://lunarnav-1114-19887-data`, and the VM picks them up within a few minutes.
- **Local development:** `scripts/data.sh pull` fetches the built stores from the bucket. `scripts/data.sh build <id>` builds one from NASA locally. Nobody uploads data by hand.
- **Before merging:** `uv sync --frozen` and `cd web && bun run build` (which includes the typecheck) must pass. Those are the same checks the image build runs.

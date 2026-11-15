# Decision 0006: on the public site, the assistant is open to access-code holders, one workspace per code

**Status:** accepted on 2026-11-15 by the owner. It narrows decision 0001 for the deployment and builds on decision 0003.

## What we decided

- **Codes, not accounts.** The deployment serves the agent only when Secret Manager holds an API key (`anthropic-api-key`) and a list of codes (`agent-codes`). Every `/agent` route except `/agent/access` answers 401 until the browser has posted a listed code; the code is kept in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/agent`. With no codes configured (a local run), nothing changes.
- **One workspace per code.** A run records the SHA-256 of the code it was started with (`<service>/agent-owners/<run_id>`). Listing shows only that code's runs, and every route on a run answers 404 for any other code.
- **No spend cap of our own.** The owner holds the spending limit on the API key in the Anthropic Console; the per-run budget (decision 0003) stays as it was.
- **The key never enters an environment.** The CLI reads it through `apiKeyHelper` from a file whose directory the Bash sandbox denies (`LUNARNAV_AGENT_API_KEY_FILE`); `sandbox-check` probes that the file and the environment hold no key.
- **The sandbox runs inside the container.** The image carries bubblewrap and socat, and the container runs with `seccomp`, `apparmor` and `systempaths` unconfined so that bubblewrap can build its nested namespaces. Bubblewrap, not Docker, is the boundary around model-written code.

## Why

Reviewers need the assistant on the live site, and the API credits are limited, so only invited people may start runs, and one reviewer's threads must not show up for another.

## What it costs

Anyone with a code can run model-written code on the VM that serves the site, with open outbound HTTPS (`LUNARNAV_AGENT_ALLOWED_DOMAINS` narrows it). Code holders are trusted to that extent. The container is less confined than before while the assistant is on. Sandboxed code can still read `/data/service` (saved plans and the owner files). Codes are bearer secrets: anyone a code is passed to gets that code's workspace.

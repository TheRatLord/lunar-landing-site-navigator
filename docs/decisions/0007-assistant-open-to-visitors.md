# Decision 0007: on the public site, the assistant is open to every visitor, one workspace per browser

**Status:** accepted on 2026-11-15 by the owner. It supersedes the access codes of decision 0006 and keeps the rest of it.

## What we decided

- **No codes, no accounts.** The deployment serves the agent whenever Secret Manager holds the API key (`anthropic-api-key`). The `agent-codes` secret and `LUNARNAV_API_AGENT_CODES` are no longer read.
- **One workspace per browser.** `GET /agent/access` gives the browser a random token in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/agent`; every other `/agent` route answers 401 without it. A run records the SHA-256 of the token it was started with (`<service>/agent-owners/<run_id>`). Listing shows only that browser's runs, and every route on a run answers 404 for any other token. The cookie keeps the name the access code had (`lunarnav_agent_code`), so a reviewer who had entered a code keeps that code's threads.
- **The total spend cap is the only limit.** As in decision 0006, the service refuses new runs and follow-ups once all runs together have cost `LUNARNAV_API_AGENT_TOTAL_BUDGET_USD` (60 USD in the deployment). `GET /agent/access` reports this as `available: false`, and the Ask panel then says that the assistant's credit is used up. It shows the same message when a turn fails because the API key has no credit.
- **One shared example.** Runs started with the showcase token are readable by every visitor and listed for everyone as an example; the Ask panel opens the newest of them the first time a browser has no thread selected. Only the holder of the token can continue them; for anyone else every route that changes such a run answers 403. The service knows only the SHA-256 of that token (`SHOWCASE_OWNER_SHA256` in `api/settings.py`; `LUNARNAV_API_AGENT_SHOWCASE_OWNER` replaces it, and an empty value turns the feature off).
- **Unchanged from decision 0006:** the key never enters an environment, and bubblewrap inside the container is the boundary around model-written code.

## Why

The judges must be able to use the assistant without being handed a code first.

## What it costs

Anyone on the internet can now run model-written code on the VM that serves the site, with open outbound HTTPS (`LUNARNAV_AGENT_ALLOWED_DOMAINS` narrows it); only the sandbox and the spend cap stand between a stranger and the machine. Any visitor can use up the credit, on purpose or not, and then nobody can use the assistant until the cap is raised. Clearing cookies loses a browser's threads. A token is a bearer secret, as a code was.

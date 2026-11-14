# Decision 0001: the service is for one trusted operator, on loopback

**Status:** accepted. Recorded on 2026-11-14 from the code, where the decision and its reason are written
(`src/lunarnav/api/settings.py`); there was no separate record before.

## Where we start

`lunarnav serve` is a FastAPI service over the engine. It also serves the analysis agent's endpoints, and
those start a model that writes and runs Python on the machine.

## What we decided

The service binds to `127.0.0.1:8000` and refuses any other address, and any non-local `Host` header,
unless `LUNARNAV_API_ALLOW_REMOTE=1` is set explicitly. No CORS origins are allowed by default: the built
web app is served by the service itself (same origin), and the Vite dev server proxies `/api`.

There are no user accounts, no API keys and no hosting. One person runs it on their own machine.

## Why

A service that can start a code-running agent must not be reachable by anyone else by accident. Binding to
loopback makes "who can reach it" the same as "who is logged in to this machine", which needs no
authentication code of our own.

## What it costs

The app can't be shared by a link. A public demo would need hosting, authentication and a way to keep the
agent off or isolated: a new decision, not a flag. Setting `LUNARNAV_API_ALLOW_REMOTE=1` is a stop-and-ask
item (`CLAUDE.md` §1).

# Decision 0004: docstrings and tests are required

**Status:** accepted on 2026-11-14 by the owner.

## Where we start

`AGENTS.md` said "Do not ever write comments or tests." The code nonetheless has module and function
docstrings throughout, with units and conventions, and there are no tests and no test runner.

## What we decided

`AGENTS.md` now says only "Follow CLAUDE.md", and `CLAUDE.md` §12 sets the rule:

- docstrings on every public module, class and function, with units, in the style already in the code;
  comments explain *why*, not what;
- a test with every change to engine logic: pytest under `tests/` for the engine, vitest for web data
  transforms, synthetic fixtures only (no downloads, network, real terrain or model calls).

## Why

The engine's claims rest on validation reports that are rerun by hand. Tests keep the closed-form and
known-geometry cases from silently breaking between those runs, and CI can run them on every pull request.
Docstrings with units are how this codebase already explains itself; the rule makes that explicit.

## What it costs

pytest, vitest and CI have to be set up first (`docs/PROGRESS.md`, "Next"). Existing code gets tests as it is
touched, not all at once.

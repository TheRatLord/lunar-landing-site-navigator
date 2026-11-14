"""Gated ingestion of user-supplied files: terrain DEMs, relay trajectories and constraint documents.

Every function here treats its input as untrusted, returns typed results, and expresses every refusal as a
machine-readable `Reason(code, message, detail)`. Nothing here writes the ledger or builds model-facing tool
classes; callers (the agent tool layer) do that.

- `terrain_dem`: `inspect_geotiff` -> `DemReport`, `build_overlay_store`, `overlay_stack`.
- `trajectory`: `load_oem` / `load_spk` -> `TrajectoryReport`, `relay_contacts` -> `RelayContacts`.
- `constraints_doc`: `read_document`, `verify_limits`, `build_constraints`.
- `common`: `Reason`, `IngestRefusal`, `run_limited` (resource-limited subprocess runner).
"""

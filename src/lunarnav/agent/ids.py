"""Content-addressed ids of stored scenarios and constraint sets.

Kept free of heavy imports so `lunarnav.agent.runtime` (which runs inside the sandbox, in model-written
scripts) can verify a stored file against its id without importing the harness.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCENARIO_ID_RE = re.compile(r"^sc-[0-9a-f]{10}$")
CONSTRAINTS_ID_RE = re.compile(r"^cons-[0-9a-f]{10}$")


def scenario_id_from_dump(dump: dict[str, Any]) -> str:
    """``sc-`` plus 10 hex digits of the canonical JSON of a scenario's ``model_dump(mode="json")``."""
    return "sc-" + hashlib.sha256(json.dumps(dump, sort_keys=True).encode()).hexdigest()[:10]


def constraints_id_of(constraints: dict[str, Any]) -> str:
    """Content-addressed id of a constraint set (its JSON dump): ``cons-`` plus 10 hex digits."""
    return "cons-" + hashlib.sha256(json.dumps(constraints, sort_keys=True).encode()).hexdigest()[:10]

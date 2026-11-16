"""Request/response models for meta, catalogue, jobs, scenarios, agent and evidence endpoints.

Field names are snake_case, units are in names (``_deg``, ``_m``, ``_km``, ``_s``, ``_utc``); times are
ISO-8601 UTC with ``Z`` suffix.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from lunarnav.catalog import LanderEntry, SiteEntry, StationEntry

try:
    from lunarnav.scenario.models import Scenario as ScenarioDocument
except ImportError:
    ScenarioDocument = dict[str, Any]  # type: ignore[misc]


SCENARIO_ID_PATTERN = r"^scen-[0-9a-f]{12}$"
"""Shape of a stored scenario id (`scen-` and 12 hex digits, as the document store issues them)."""


class Strict(BaseModel):
    """Request base: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")


class KernelInfo(BaseModel):
    name: str
    sha256: str
    size_bytes: int
    role: str
    url: str | None = None
    coverage_utc: tuple[str, str] | None = Field(default=None, description="First and last covered instant, UTC.")


class KernelSetInfo(BaseModel):
    available: bool = Field(description="False when the kernels could not be loaded (see `error`).")
    error: str | None = None
    valid_utc: tuple[str, str] | None = Field(default=None, description="Epoch range over which all kernels are valid.")
    files: list[KernelInfo] = []


class StoreCoverage(BaseModel):
    """Bounding circle of a store's footprint (the store itself is a grid in its own projection; the circle contains it)."""

    whole_moon: bool = Field(description="A whole-Moon grid (no bounding circle).")
    centre_lat_deg: float | None
    centre_lon_deg: float | None
    radius_deg: float | None = Field(description="Angular radius of the circle on the Moon, degrees.")


class TerrainStoreInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    dem_id: str
    meta_sha256: str
    description: str | None = None
    projection: str | None = None
    pixel_size_m: float | None = None
    shape: list[int | None] | None = None
    n_levels: int | None = None
    error: str | None = None
    precedence: int | None = Field(default=None, description="Rank in the engine's precedence order (1 = wins where it has data); the list is in this order.")
    sigma_z_m: float | None = Field(default=None, description="Stated vertical (1-sigma) error of the product, m (median of the per-pixel layer where there is one).")
    sigma_xy_m: float | None = Field(default=None, description="Stated horizontal error, m.")
    error_basis_z: str | None = Field(default=None, description="Basis of the vertical error: published, published-method, measured or assumed.")
    error_source: str | None = Field(default=None, description="Where the stated error comes from.")
    coverage: StoreCoverage | None = Field(default=None, description="Footprint of the store.")


class RegionalBracketCoverage(BaseModel):
    coverage: float = Field(description="Share of the independent cells whose exact value lay inside the estimated [lo, hi] bracket.")
    misses: int
    cells: int = Field(description="Independent cells the measurement used (all areas together).")
    calibration_target: float


class RegionalLayerValidation(BaseModel):
    layer: str
    point_value: Literal["supported", "approximate", "bracket_only"] = Field(
        description="How the per-cell value may be read: `supported` (within its measured error), `approximate` (typical error small, tail large: show the bracket beside it), `bracket_only` (never show the value alone).")
    unit: str = Field(description="Unit of the layer values.")
    error_unit: str = Field(description="Unit of `measured_error`.")
    bracket_coverage: RegionalBracketCoverage
    measured_error: dict[str, Any] = Field(description="`unit`, `mean_signed`, `mean_abs`, `p95_abs`, `p99_abs`, `max_abs`: regional minus exact, in `error_unit`.")


class RegionalValidationRecord(BaseModel):
    """The record the package ships (`lunarnav/regional/validation_reference.json`), served as it is so no client carries a copy."""

    document: str = Field(description="Where the measurement is described: file and section under `docs/`.")
    measured_by: str = Field(description="Script, areas, cells per area, seed and how the cells were chosen (verbatim from the record).")
    configuration: dict[str, Any] = Field(description="The configuration the measurement was made at (mast, rules, spacing, step, period, stores, calibration cells).")
    layers: list[RegionalLayerValidation]


class MetaResponse(BaseModel):
    service_version: str = Field(description="Version of the HTTP API contract (path prefix /api/v1).")
    code_version: str = Field(description="Installed lunarnav package version.")
    python_version: str
    kernels: KernelSetInfo
    terrain_stores: list[TerrainStoreInfo]
    horizon_module_available: bool
    scenario_module_available: bool
    agent_enabled: bool = Field(description="Whether the agent endpoints are served (`LUNARNAV_API_AGENT_ENABLED`).")
    job_kinds: dict[str, str] = Field(description="Registered long-computation kinds and their version strings.")
    limits: dict[str, int | float] = Field(description="Named request limits enforced by the service (`lunarnav.api.limits`; the docs list what each bounds).")
    conventions: dict[str, str] = Field(description="Normative coordinate, time and unit conventions.")


class SitePage(BaseModel):
    total: int = Field(description="Matches before limit/offset.")
    items: list[SiteEntry]


class StationPage(BaseModel):
    total: int
    items: list[StationEntry]


class LanderPage(BaseModel):
    total: int
    items: list[LanderEntry]


class NetworkCount(BaseModel):
    network: str
    count: int


class QueueAhead(BaseModel):
    id: str
    kind: str
    label: str
    state: Literal["running", "queued"]


class QueueInfo(BaseModel):
    """Where a queued job stands in its class and what it waits for."""

    position: int = Field(ge=1, description="1-based place among the queued jobs of its class (1 = next to start).")
    waiting_for: Literal["worker", "long-limit"] = Field(description="`worker`: every worker is busy. `long-limit`: a long job is held back because long jobs already use all the workers they may; a free worker stays for short jobs.")
    ahead_count: int = Field(ge=0, description="Jobs that must finish or start first: the running jobs it waits for plus the queued jobs of its class before it.")
    ahead: list[QueueAhead] = Field(description="The first (at most 10) of them, running ones first, then queued ones in queue order.")


class JobStatus(BaseModel):
    """Job record; also the payload of every ``status`` server-sent event."""

    id: str
    kind: str
    label: str
    state: Literal["queued", "running", "done", "failed", "cancelled"]
    progress: float | None = Field(description="0..1, null when unknown.")
    stage: str
    created_ms: int = Field(description="Unix epoch milliseconds.")
    started_ms: int | None
    finished_ms: int | None
    cached: bool = Field(description="True when the result came from the disk cache without computing.")
    cancel_requested: bool
    holders: int = Field(description="Clients that submitted this same request and have not cancelled; the job stops when the last one cancels (cancelling with others still holding only lets go).")
    error: dict[str, str] | None
    result_bytes: int | None
    cache_key: str = Field(description="SHA-256 of (kind, kind version, canonical request, data versions).")
    job_class: Literal["short", "long"] = Field(description="`long` kinds (site search, regional layers) may hold at most `workers - 1` workers so a short analysis never waits behind them; queue order is first come, first served within a class.")
    queue: QueueInfo | None = Field(description="Why the job waits: set while it is queued and not yet handed to a worker, null otherwise. Re-sent as a `status` event whenever it changes.")


class CancelReply(JobStatus):
    """The job record after a cancel request, with what the request did."""

    effect: Literal["cancelled", "requested", "detached", "already_finished"] = Field(
        description="`cancelled`: a queued job stopped; `requested`: a running job stops at its next progress report (state still running); "
                    "`detached`: other requests still want the job, so only this request let go and the job goes on; `already_finished`.")
    still_wanted_by: int = Field(description="With `detached`: how many other requests still want the job (0 otherwise).")
    detail: str = Field(description="One sentence for the user that says what happened.")


class ScenarioCreate(Strict):
    document: dict[str, Any] = Field(description="A `lunarnav.scenario.models.Scenario` document.")


class ScenarioUpdate(Strict):
    expected_version: int = Field(ge=1, description="Version this edit was based on; a mismatch returns 409.")
    document: dict[str, Any]


class ScenarioSummary(BaseModel):
    id: str
    name: str
    version: int
    created_utc: str
    updated_utc: str


class ScenarioRecord(ScenarioSummary):
    document: ScenarioDocument = Field(description="The stored, normalised `Scenario`.")


class ScenarioValidation(BaseModel):
    ok: Literal[True] = True
    document: ScenarioDocument = Field(description="The document after validation and normalisation (defaults filled in).")


class ScenarioPage(BaseModel):
    total: int
    items: list[ScenarioSummary]


class RevisionInfo(BaseModel):
    version: int
    name: str
    saved_utc: str


MODEL_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:\-\[\]]{0,79}$"


class AccessState(BaseModel):
    available: bool = Field(description="Whether a new thread or a follow-up can be started now.")
    reason: Literal["budget-spent"] | None = Field(
        default=None, description="Why not: `budget-spent` when the service's total spend cap (`LUNARNAV_API_AGENT_TOTAL_BUDGET_USD`) is used up.")


class RunCreate(Strict):
    prompt: str = Field(min_length=1, max_length=50_000, description="First user message of the run.")
    model: str | None = Field(default=None, pattern=MODEL_PATTERN, description="Model id; default from the harness config.")
    budget_usd: float | None = Field(
        default=None, gt=0, allow_inf_nan=False,
        description="Spend cap of this run in USD (API-equivalent cost the CLI reports). Default: the service's default cap (5 USD "
                    "unless configured). Above the service's ceiling (`LUNARNAV_API_AGENT_BUDGET_CEILING_USD`, 25 USD) it is a 422. "
                    "Returned as `budget_usd` in the run status and kept across resumes.")


class MessageCreate(Strict):
    prompt: str = Field(min_length=1, max_length=50_000)


class RunMeta(BaseModel):
    """Run metadata (``run.json``) plus liveness."""

    model_config = ConfigDict(extra="allow")

    run_id: str
    state: str = Field(description="created | idle | running | closed (running while a turn is in progress).")
    status: str | None = None
    model: str
    created_at: str | None = None
    updated_at: str | None = None
    turns: int = 0
    cost_usd: float | None = Field(
        default=None,
        description="Total cost of the run **as of its last completed turn** (USD). The CLI reports cost only with a turn's result, "
                    "so this does not move while a turn runs and is null until the first turn completes; the service never estimates it.")
    budget_usd: float | None = Field(default=None, description="The run's spend cap in USD; null for no cap.")
    first_prompt: str | None = None
    prompt_version: str | None = None
    prompt_sha256: str | None = None
    prompt_template_sha256: str = Field(description="Hash of the packaged prompt template.")
    session_id: str | None = None
    workspace: str | None = None
    live: bool = Field(description="A session for this run is connected in this service process.")
    busy: bool = Field(description="A turn is running.")
    shared: bool = Field(default=False, description="A shared example: every visitor can read it, only its owner can continue it.")
    sandbox: dict[str, Any] | None = Field(default=None, description="Sandbox status from the latest run_start event.")


class ChainStatus(BaseModel):
    ok: bool
    problems: list[str]


class LedgerList(BaseModel):
    entries: list[dict[str, Any]]
    chain: ChainStatus


class LedgerResult(BaseModel):
    """The full stored result of one ledger entry (what the agent's tool returned), hash-verified against the ledger."""

    ledger_id: str
    tool: str | None
    kind: str = Field(description="Source kind of the entry (`engine_result`, ...): what a number cited from it is attributed to.")
    size_bytes: int = Field(description="Size of the whole output as compact JSON.")
    rows: dict[str, str] = Field(description="Declared row lists: dotted path -> the key field of their rows.")
    row_ids: list[str] = Field(description="The ids a `[L0006#id]` citation may name; a row nested in a row is `parent/child`.")
    output: Any | None = Field(description="The whole output when it is at most `limit_bytes`; null otherwise (use `skeleton` and `row_id`).")
    skeleton: Any | None = Field(description="Set when `output` is null: the output with every declared row list replaced by null; fetch rows with `row_id`.")
    row_id: str | None = Field(description="The row asked for with `?row_id=`.")
    row: list[Any] | None = Field(description="That row (a list: rows with the same id are merged, usually one); null without `row_id`.")
    limit_bytes: int


class Instructions(BaseModel):
    model: str
    default_model: str
    prompt_version: str
    prompt_sha256: str
    prompt_template_sha256: str = Field(description="Hash of the packaged template file (same for every run of a version); prompt_sha256 is the rendered text.")
    instructions: str = Field(description="Full system prompt text.")
    tools: list[dict[str, Any]]
    permission_policy: dict[str, Any]
    sandbox: dict[str, Any]
    versions: dict[str, str]
    workspace: str
    max_budget_usd: float | None = Field(
        description="Spend limit applied to every run (API-equivalent cost as reported by the CLI); null means no limit. "
                    "Service default 5.00; `LUNARNAV_API_AGENT_MAX_BUDGET_USD`, 0 = no limit.")


class EvidenceDoc(BaseModel):
    id: str = Field(description="Path under docs/ without extension, e.g. validation/visibility.")
    title: str = Field(description="First level-1 heading, else the file name.")
    path: str = Field(description="Repository-relative path, e.g. docs/validation/visibility.md.")
    kind: Literal["validation", "research"]
    modified_utc: str
    size_bytes: int


class PoolState(BaseModel):
    state: Literal["disabled", "warming", "ready", "failed", "stopping"] = Field(
        description="`warming` until every worker has loaded its kernels and compiled the numerical code.")
    workers: int
    warm: int = Field(description="Workers warmed so far.")
    seconds: float | None = Field(default=None, description="Wall time the warm-up took (when ready).")
    error: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    warm: bool = Field(description="True when the compute pool is ready (or warm-up is disabled).")
    pool: PoolState


class SignoffRequest(BaseModel):
    decision: Literal["accepted", "rejected"]
    who: str = Field(min_length=1, max_length=2000, description="Who decides (a name or role); required.")
    note: str = Field(min_length=1, max_length=2000, description="Why; required.")


class SignoffRecord(BaseModel):
    decision: Literal["accepted", "rejected"]
    who: str
    ts: str
    note: str


class AssumptionItem(BaseModel):
    assumption_id: str
    ts: str
    statement: str
    basis: str
    impact: str
    needs_signoff: bool
    status: Literal["accepted", "rejected", "pending", "not_required"] = Field(
        description="Latest sign-off decision; `pending` = needs one and has none. A rejected assumption blocks "
                    "reuse: engine tools refuse inputs that depend on it.")
    signoffs: list[SignoffRecord] = Field(description="Every decision, oldest first.")
    used_by: list[str] = Field(description="Ledger ids of engine calls that depended on it.")


class AssumptionList(BaseModel):
    assumptions: list[AssumptionItem]
    chain: ChainStatus


class InboxEntry(BaseModel):
    name: str
    path: str = Field(description="Relative to the run workspace (the agent reads `inbox/<name>`).")
    size_bytes: int
    sha256: str
    source_name: str | None = Field(default=None, description="The filename the client sent (upload response only); `name` is the sanitised stored name.")


class InboxList(BaseModel):
    files: list[InboxEntry]

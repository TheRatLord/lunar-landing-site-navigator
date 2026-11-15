FROM oven/bun:1.4.4 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

FROM python:3.14-slim-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY docs ./docs
RUN uv sync --frozen --no-dev \
 && .venv/bin/python -m compileall -q src
COPY --from=web /web/dist ./web/dist
ENV PATH=/app/.venv/bin:$PATH \
    HOME=/tmp \
    LUNARNAV_DATA=/data \
    LUNARNAV_AGENT_RUNS_DIR=/data/runs \
    NUMBA_CACHE_DIR=/data/numba-cache \
    LUNARNAV_API_HOST=127.0.0.1 \
    LUNARNAV_API_PORT=8100
USER 1000:1000
EXPOSE 8100
CMD ["lunarnav", "serve"]

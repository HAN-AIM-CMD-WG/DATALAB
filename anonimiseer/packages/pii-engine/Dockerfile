# syntax=docker/dockerfile:1.7
# Multi-stage build voor de pii-engine microservice.
# - Stage 1 (builder): installeer alles incl. spaCy-model.
# - Stage 2 (runtime): slanke image met alleen runtime-deps.

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY pii_engine ./pii_engine

# Installeer met 'nl-large'-extra voor het grote NL spaCy-model.
# Voor CI-only builds kun je dit vervangen door 'nl-small'.
RUN pip install --upgrade pip \
    && pip install ".[nl-large]"

# ---------------------------------------------------------------------------

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PII_ENGINE_HOST=0.0.0.0 \
    PII_ENGINE_PORT=8765

WORKDIR /app

# Niet-root user.
RUN useradd --create-home --shell /usr/sbin/nologin pii
USER pii

COPY --from=builder --chown=pii:pii /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder --chown=pii:pii /usr/local/bin /usr/local/bin
COPY --chown=pii:pii pii_engine ./pii_engine
COPY --chown=pii:pii README.md ./

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health').read()"

CMD ["pii-engine"]

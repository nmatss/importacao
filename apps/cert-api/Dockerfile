# =============================================================================
# cert-api Dockerfile — Multi-stage build with non-root user (uid 1001)
# =============================================================================

# ---- Stage 1: Oracle Instant Client ----
FROM python:3.12-slim AS oracle-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip libaio1t64 \
    && ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://download.oracle.com/otn_software/linux/instantclient/2370000/instantclient-basiclite-linux.x64-23.7.0.25.01.zip \
    -o /tmp/ic.zip \
    && unzip -q /tmp/ic.zip -d /opt/oracle \
    && rm /tmp/ic.zip

# ---- Stage 2: Python dependencies ----
FROM python:3.12-slim AS deps

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    freetds-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --target=/build/site-packages -r requirements.txt

# ---- Stage 3: Runtime ----
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    freetds-bin libaio1t64 curl \
    && ln -sf /usr/lib/x86_64-linux-gnu/libaio.so.1t64 /usr/lib/x86_64-linux-gnu/libaio.so.1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=oracle-builder /opt/oracle/instantclient_23_7 /opt/oracle/instantclient_23_7
RUN echo /opt/oracle/instantclient_23_7 > /etc/ld.so.conf.d/oracle.conf && ldconfig

ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_23_7

COPY --from=deps /build/site-packages /usr/local/lib/python3.12/site-packages

RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /bin/bash appuser

WORKDIR /app

COPY --chown=appuser:appgroup . .
RUN mkdir -p reports && chown appuser:appgroup reports

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

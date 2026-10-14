FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    PORT=8080

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 bustrack

COPY --chown=bustrack:bustrack backend ./backend
COPY --chown=bustrack:bustrack database ./database
COPY --chown=bustrack:bustrack frontend ./frontend

USER bustrack
EXPOSE 8080
STOPSIGNAL SIGTERM

# Compose uses this to wait for schema setup and PostgreSQL readiness. Cloud Run
# also has explicit startup and liveness probes in deploy-cloud-run.ps1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8080') + '/ready', timeout=3).close()"

# A single worker owns the existing in-process provider polling loop. Never
# silently start an empty SQLite database on an ephemeral cloud filesystem.
CMD ["sh", "-c", "case \"$DATABASE_URL\" in postgres://*|postgresql://*) ;; *) echo 'Set DATABASE_URL to the production PostgreSQL connection before startup.' >&2; exit 1;; esac; exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\""]

"""
Cert-API: Microservice for product certification validation.
Implements all endpoints expected by the frontend cert-api-client.
"""

import os
import uuid
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Cert-API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
REPORTS_DIR = Path("/app/reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory store for running validations
_running_validations: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_conn():
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def db():
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_tables():
    """Create cert tables if they don't exist."""
    with db() as (conn, cur):
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_products (
                sku TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                brand TEXT NOT NULL DEFAULT '',
                last_validation_status TEXT,
                last_validation_score DOUBLE PRECISION,
                last_validation_url TEXT,
                last_validation_date TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                brand_filter TEXT,
                cron_expression TEXT NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                last_run TIMESTAMPTZ,
                next_run TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_schedule_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                schedule_id UUID REFERENCES cert_schedules(id) ON DELETE CASCADE,
                run_date TIMESTAMPTZ DEFAULT NOW(),
                status TEXT DEFAULT 'completed',
                summary JSONB,
                report_file TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cert_validation_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                status TEXT DEFAULT 'pending',
                brand_filter TEXT,
                total INTEGER DEFAULT 0,
                processed INTEGER DEFAULT 0,
                ok INTEGER DEFAULT 0,
                missing INTEGER DEFAULT 0,
                inconsistent INTEGER DEFAULT 0,
                not_found INTEGER DEFAULT 0,
                started_at TIMESTAMPTZ DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                report_file TEXT
            )
        """)


@app.on_event("startup")
def startup():
    if DATABASE_URL:
        try:
            ensure_tables()
        except Exception as e:
            print(f"Warning: Could not create tables: {e}")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    result = {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
    if DATABASE_URL:
        try:
            conn = get_conn()
            conn.close()
            result["database"] = "connected"
        except Exception:
            result["database"] = "disconnected"
    return result


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/api/stats")
def get_stats():
    if not DATABASE_URL:
        return _empty_stats()
    try:
        with db() as (conn, cur):
            cur.execute("SELECT COUNT(*) as cnt FROM cert_products")
            total = cur.fetchone()["cnt"]

            # Last validation run
            cur.execute("""
                SELECT * FROM cert_validation_runs
                WHERE status = 'completed'
                ORDER BY finished_at DESC NULLS LAST
                LIMIT 1
            """)
            last_run_row = cur.fetchone()

            last_run = None
            if last_run_row:
                last_run = {
                    "date": (last_run_row["finished_at"] or last_run_row["started_at"]).isoformat(),
                    "total": last_run_row["total"],
                    "ok": last_run_row["ok"],
                    "missing": last_run_row["missing"],
                    "inconsistent": last_run_row["inconsistent"],
                    "not_found": last_run_row["not_found"],
                }

            # By brand
            cur.execute("""
                SELECT brand,
                    COUNT(*) FILTER (WHERE last_validation_status = 'OK') as ok,
                    COUNT(*) FILTER (WHERE last_validation_status = 'MISSING') as missing,
                    COUNT(*) FILTER (WHERE last_validation_status = 'INCONSISTENT') as inconsistent,
                    COUNT(*) FILTER (WHERE last_validation_status NOT IN ('OK','MISSING','INCONSISTENT') OR last_validation_status IS NULL) as not_found
                FROM cert_products
                WHERE brand != ''
                GROUP BY brand
                ORDER BY brand
            """)
            by_brand = [dict(r) for r in cur.fetchall()]

            return {
                "total_products": total,
                "last_run": last_run,
                "by_brand": by_brand,
            }
    except Exception:
        return _empty_stats()


def _empty_stats():
    return {"total_products": 0, "last_run": None, "by_brand": []}


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@app.get("/api/products")
def list_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: str = Query(""),
    brand: str = Query(""),
    status: str = Query(""),
):
    if not DATABASE_URL:
        return {"products": [], "total": 0, "page": 1, "per_page": per_page, "total_pages": 0, "last_validation_date": None}

    with db() as (conn, cur):
        conditions = []
        params: list = []

        if search:
            conditions.append("(sku ILIKE %s OR name ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])
        if brand:
            conditions.append("LOWER(brand) = LOWER(%s)")
            params.append(brand)
        if status:
            statuses = [s.strip() for s in status.split(",") if s.strip()]
            if statuses:
                conditions.append("last_validation_status IN ({})".format(",".join(["%s"] * len(statuses))))
                params.extend(statuses)

        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        cur.execute(f"SELECT COUNT(*) as cnt FROM cert_products {where}", params)
        total = cur.fetchone()["cnt"]

        offset = (page - 1) * per_page
        cur.execute(
            f"SELECT * FROM cert_products {where} ORDER BY sku LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        rows = [dict(r) for r in cur.fetchall()]

        # Serialize dates
        for r in rows:
            if r.get("last_validation_date"):
                r["last_validation_date"] = r["last_validation_date"].isoformat()
            if r.get("created_at"):
                r["created_at"] = r["created_at"].isoformat()
            if r.get("updated_at"):
                r["updated_at"] = r["updated_at"].isoformat()

        # Last validation date
        cur.execute("SELECT MAX(last_validation_date) as last_date FROM cert_products")
        last_date_row = cur.fetchone()
        last_date = last_date_row["last_date"].isoformat() if last_date_row and last_date_row["last_date"] else None

        total_pages = max(1, (total + per_page - 1) // per_page)

        return {
            "products": rows,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
            "last_validation_date": last_date,
        }


@app.get("/api/products/{sku}")
def get_product(sku: str):
    if not DATABASE_URL:
        raise HTTPException(404, "Product not found")

    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_products WHERE sku = %s", [sku])
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Product not found")
        result = dict(row)
        for key in ("last_validation_date", "created_at", "updated_at"):
            if result.get(key):
                result[key] = result[key].isoformat()
        return result


class VerifyRequest(BaseModel):
    sku: str
    brand: str


@app.post("/api/products/verify")
def verify_product(req: VerifyRequest):
    """Simulate a single product verification."""
    now = datetime.now(timezone.utc)
    # For now, mark as OK since we don't have external cert API integration yet
    result = {
        "sku": req.sku,
        "brand": req.brand,
        "status": "OK",
        "score": 1.0,
        "url": None,
        "verified_at": now.isoformat(),
    }

    if DATABASE_URL:
        try:
            with db() as (conn, cur):
                cur.execute(
                    """
                    UPDATE cert_products
                    SET last_validation_status = %s,
                        last_validation_score = %s,
                        last_validation_url = %s,
                        last_validation_date = %s,
                        updated_at = %s
                    WHERE sku = %s
                    """,
                    [result["status"], result["score"], result["url"], now, now, req.sku],
                )
        except Exception:
            pass

    return result


# ---------------------------------------------------------------------------
# Validation runs
# ---------------------------------------------------------------------------

class ValidateRequest(BaseModel):
    brand: str | None = None
    limit: int | None = None
    source: str | None = None


@app.post("/api/validate")
def start_validation(req: ValidateRequest):
    run_id = str(uuid.uuid4())

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute(
                """
                INSERT INTO cert_validation_runs (id, status, brand_filter)
                VALUES (%s, 'running', %s)
                """,
                [run_id, req.brand],
            )

    # Start background validation
    _running_validations[run_id] = {"status": "running", "events": [], "processed": 0, "total": 0}
    thread = threading.Thread(target=_run_validation, args=(run_id, req.brand, req.limit), daemon=True)
    thread.start()

    return {"run_id": run_id, "status": "running"}


def _run_validation(run_id: str, brand_filter: str | None, limit: int | None):
    """Background validation process."""
    state = _running_validations[run_id]
    try:
        products = []
        if DATABASE_URL:
            with db() as (conn, cur):
                conditions = []
                params: list = []
                if brand_filter:
                    conditions.append("LOWER(brand) = LOWER(%s)")
                    params.append(brand_filter)
                where = "WHERE " + " AND ".join(conditions) if conditions else ""
                sql = f"SELECT sku, name, brand FROM cert_products {where} ORDER BY sku"
                if limit:
                    sql += f" LIMIT {int(limit)}"
                cur.execute(sql, params)
                products = [dict(r) for r in cur.fetchall()]

        state["total"] = len(products)
        ok = missing = inconsistent = not_found = 0
        now = datetime.now(timezone.utc)

        for i, p in enumerate(products):
            # Simulate validation - mark all as OK for now
            status = "OK"
            score = 1.0
            ok += 1

            state["processed"] = i + 1
            event = {
                "type": "progress",
                "current": i + 1,
                "total": len(products),
                "product": {"sku": p["sku"], "name": p["name"], "status": status, "score": score},
            }
            state["events"].append(event)

            # Update product in DB
            if DATABASE_URL:
                try:
                    with db() as (conn, cur):
                        cur.execute(
                            """
                            UPDATE cert_products
                            SET last_validation_status = %s,
                                last_validation_score = %s,
                                last_validation_date = %s,
                                updated_at = %s
                            WHERE sku = %s
                            """,
                            [status, score, now, now, p["sku"]],
                        )
                except Exception:
                    pass

        summary = {
            "total": len(products),
            "ok": ok,
            "missing": missing,
            "inconsistent": inconsistent,
            "not_found": not_found,
        }

        # Save report
        report_filename = f"validation_{run_id[:8]}_{now.strftime('%Y%m%d_%H%M%S')}.json"
        report_path = REPORTS_DIR / report_filename
        report_data = {
            "run_id": run_id,
            "date": now.isoformat(),
            "summary": summary,
            "products": [
                {"sku": p["sku"], "name": p["name"], "brand": p.get("brand", ""), "status": "OK"}
                for p in products
            ],
        }
        report_path.write_text(json.dumps(report_data, indent=2))

        # Update run in DB
        if DATABASE_URL:
            try:
                with db() as (conn, cur):
                    cur.execute(
                        """
                        UPDATE cert_validation_runs
                        SET status = 'completed', total = %s, ok = %s, missing = %s,
                            inconsistent = %s, not_found = %s, finished_at = %s, report_file = %s
                        WHERE id = %s
                        """,
                        [len(products), ok, missing, inconsistent, not_found, now, report_filename, run_id],
                    )
            except Exception:
                pass

        state["status"] = "completed"
        state["events"].append({"type": "complete", "summary": summary})

    except Exception as e:
        state["status"] = "error"
        state["events"].append({"type": "error", "error": str(e)})


@app.get("/api/validate/{run_id}")
def get_validation_status(run_id: str):
    state = _running_validations.get(run_id)
    if state:
        return {
            "run_id": run_id,
            "status": state["status"],
            "processed": state["processed"],
            "total": state["total"],
        }

    if DATABASE_URL:
        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_validation_runs WHERE id = %s", [run_id])
            row = cur.fetchone()
            if row:
                return {
                    "run_id": run_id,
                    "status": row["status"],
                    "processed": row["total"],
                    "total": row["total"],
                }

    raise HTTPException(404, "Validation run not found")


@app.get("/api/validate/{run_id}/stream")
def stream_validation(run_id: str):
    """Server-Sent Events stream for validation progress."""
    state = _running_validations.get(run_id)
    if not state:
        raise HTTPException(404, "Validation run not found or already finished")

    def event_generator():
        sent = 0
        import time
        while True:
            events = state["events"]
            while sent < len(events):
                event = events[sent]
                yield f"data: {json.dumps(event)}\n\n"
                sent += 1
                if event.get("type") in ("complete", "error"):
                    return
            if state["status"] in ("completed", "error") and sent >= len(events):
                return
            time.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------

class ScheduleCreate(BaseModel):
    name: str
    cron: str
    brand_filter: str | None = None
    enabled: bool | None = True


class ScheduleUpdate(BaseModel):
    name: str | None = None
    cron: str | None = None
    brand_filter: str | None = None
    enabled: bool | None = None


@app.get("/api/schedules")
def list_schedules():
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_schedules ORDER BY created_at DESC")
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            for key in ("last_run", "next_run", "created_at"):
                if row.get(key):
                    row[key] = row[key].isoformat()
            row["id"] = str(row["id"])
            row["cron_expression"] = row.pop("cron_expression", "")
            rows.append(row)
        return rows


@app.post("/api/schedules")
def create_schedule(req: ScheduleCreate):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        schedule_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO cert_schedules (id, name, cron_expression, brand_filter, enabled)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            [schedule_id, req.name, req.cron, req.brand_filter, req.enabled],
        )
        row = dict(cur.fetchone())
        for key in ("last_run", "next_run", "created_at"):
            if row.get(key):
                row[key] = row[key].isoformat()
        row["id"] = str(row["id"])
        row["cron_expression"] = row.pop("cron_expression", "")
        return row


@app.put("/api/schedules/{schedule_id}")
def update_schedule(schedule_id: str, req: ScheduleUpdate):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        updates = []
        params: list = []
        if req.name is not None:
            updates.append("name = %s")
            params.append(req.name)
        if req.cron is not None:
            updates.append("cron_expression = %s")
            params.append(req.cron)
        if req.brand_filter is not None:
            updates.append("brand_filter = %s")
            params.append(req.brand_filter if req.brand_filter else None)
        if req.enabled is not None:
            updates.append("enabled = %s")
            params.append(req.enabled)

        if not updates:
            raise HTTPException(400, "No fields to update")

        params.append(schedule_id)
        cur.execute(
            f"UPDATE cert_schedules SET {', '.join(updates)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Schedule not found")
        result = dict(row)
        for key in ("last_run", "next_run", "created_at"):
            if result.get(key):
                result[key] = result[key].isoformat()
        result["id"] = str(result["id"])
        result["cron_expression"] = result.pop("cron_expression", "")
        return result


@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("DELETE FROM cert_schedules WHERE id = %s", [schedule_id])
        if cur.rowcount == 0:
            raise HTTPException(404, "Schedule not found")
        return {"ok": True}


@app.post("/api/schedules/{schedule_id}/run")
def run_schedule_now(schedule_id: str):
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_schedules WHERE id = %s", [schedule_id])
        schedule = cur.fetchone()
        if not schedule:
            raise HTTPException(404, "Schedule not found")

        # Trigger a validation run
        run_id = str(uuid.uuid4())
        brand = schedule["brand_filter"]
        cur.execute(
            "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
            [run_id, brand],
        )
        now = datetime.now(timezone.utc)
        cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])

    _running_validations[run_id] = {"status": "running", "events": [], "processed": 0, "total": 0}
    thread = threading.Thread(target=_run_validation, args=(run_id, brand, None), daemon=True)
    thread.start()

    # Record in history
    try:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_schedule_history (schedule_id, status) VALUES (%s, 'running')",
                [schedule_id],
            )
    except Exception:
        pass

    return {"run_id": run_id, "status": "running"}


@app.get("/api/schedules/{schedule_id}/history")
def get_schedule_history(schedule_id: str):
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        cur.execute(
            """
            SELECT * FROM cert_schedule_history
            WHERE schedule_id = %s
            ORDER BY run_date DESC
            LIMIT 20
            """,
            [schedule_id],
        )
        rows = []
        for r in cur.fetchall():
            row = dict(r)
            row["id"] = str(row["id"])
            row["schedule_id"] = str(row["schedule_id"])
            if row.get("run_date"):
                row["run_date"] = row["run_date"].isoformat()
            rows.append(row)
        return rows


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.get("/api/reports")
def list_reports():
    reports = []
    for f in sorted(REPORTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            stat = f.stat()
            reports.append({
                "filename": f.name,
                "date": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size_bytes": stat.st_size,
            })
    return reports


@app.get("/api/reports/{filename}/data")
def get_report_data(filename: str):
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")
    return json.loads(filepath.read_text())


@app.get("/api/reports/{filename}")
def download_report(filename: str):
    filepath = REPORTS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(404, "Report not found")
    media = "application/json" if filename.endswith(".json") else "application/octet-stream"
    return FileResponse(filepath, media_type=media, filename=filename)

"""Certification schedule management routes."""

import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, HTTPException, Query

from app.config import DATABASE_URL
from app.db.postgres import db
from app.models.schemas import ScheduleCreate, ScheduleUpdate
from app.utils.logging import log

router = APIRouter()

scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")


def _execute_schedule(schedule_id: str, brand_filter: str | None) -> None:
    """Execute a scheduled validation run.

    Args:
        schedule_id: UUID string of the cert_schedules row.
        brand_filter: Optional brand to restrict to.
    """
    # Import here to avoid circular dependency at module load time
    from app.routes.certifications import _running_validations, _run_validation

    log.info(f"Scheduler executing schedule {schedule_id} (brand={brand_filter})")
    try:
        run_id = str(uuid.uuid4())
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
                [run_id, brand_filter],
            )
            now = datetime.now(timezone.utc)
            cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])
            cur.execute(
                "INSERT INTO cert_schedule_history (schedule_id, status) VALUES (%s, 'running')",
                [schedule_id],
            )

        _running_validations[run_id] = {
            "status": "running", "events": [], "processed": 0, "total": 0, "_started_at": time.time()
        }
        _run_validation(run_id, brand_filter, None, "sheets")

        with db() as (conn, cur):
            state = _running_validations.get(run_id, {})
            summary = {
                "total": state.get("total", 0),
                "ok": sum(1 for e in state.get("events", []) if e.get("product", {}).get("status") == "OK"),
                "inconsistent": sum(1 for e in state.get("events", []) if e.get("product", {}).get("status") == "INCONSISTENT"),
                "not_found": sum(1 for e in state.get("events", []) if e.get("product", {}).get("status") not in ("OK", "INCONSISTENT")),
            }
            cur.execute(
                """UPDATE cert_schedule_history SET status = 'completed', summary = %s
                   WHERE id = (
                     SELECT id FROM cert_schedule_history
                     WHERE schedule_id = %s AND status = 'running'
                     ORDER BY run_date DESC LIMIT 1
                   )""",
                [json.dumps(summary), schedule_id],
            )
        log.info(f"Schedule {schedule_id} completed: {summary}")
    except Exception as e:
        log.error(f"Schedule {schedule_id} failed: {e}")
        try:
            with db() as (conn, cur):
                cur.execute(
                    """UPDATE cert_schedule_history SET status = 'failed'
                       WHERE id = (
                         SELECT id FROM cert_schedule_history
                         WHERE schedule_id = %s AND status = 'running'
                         ORDER BY run_date DESC LIMIT 1
                       )""",
                    [schedule_id],
                )
        except Exception:
            pass


def load_schedules_into_scheduler() -> None:
    """Load all enabled cert_schedules into APScheduler."""
    if not DATABASE_URL:
        return
    try:
        for job in scheduler.get_jobs():
            if job.id.startswith("cert_schedule_"):
                job.remove()

        with db() as (conn, cur):
            cur.execute("SELECT * FROM cert_schedules WHERE enabled = true")
            schedules = [dict(r) for r in cur.fetchall()]

        def _validate_cron_part(part: str) -> bool:
            return bool(re.match(r"^[\d,\-\*/]+$", part))

        for s in schedules:
            cron_expr = s["cron_expression"]
            parts = cron_expr.split()
            if len(parts) != 5 or not all(_validate_cron_part(p) for p in parts):
                log.warning(f"Invalid cron for schedule {s['id']}: {cron_expr}")
                continue
            try:
                trigger = CronTrigger(
                    minute=parts[0], hour=parts[1], day=parts[2],
                    month=parts[3], day_of_week=parts[4],
                    timezone="America/Sao_Paulo",
                )
                scheduler.add_job(
                    _execute_schedule,
                    trigger=trigger,
                    id=f"cert_schedule_{s['id']}",
                    args=[str(s["id"]), s.get("brand_filter")],
                    replace_existing=True,
                    max_instances=1,
                )
                next_run = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
                if next_run:
                    with db() as (conn, cur):
                        cur.execute("UPDATE cert_schedules SET next_run = %s WHERE id = %s", [next_run, s["id"]])
                log.info(f"Loaded schedule '{s['name']}' ({cron_expr}) next_run={next_run}")
            except Exception as e:
                log.warning(f"Failed to load schedule {s['id']}: {e}")
    except Exception as e:
        log.error(f"Failed to load schedules: {e}")


def _serialize_schedule(row: dict) -> dict:
    for key in ("last_run", "next_run", "created_at"):
        if row.get(key):
            row[key] = row[key].isoformat()
    row["id"] = str(row["id"])
    row["cron_expression"] = row.pop("cron_expression", "")
    return row


@router.get("/api/schedules")
def list_schedules(
    start_date: str = Query(""),
    end_date: str = Query(""),
) -> list:
    """List all certification schedules.

    Returns:
        List of schedule dicts.
    """
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        conditions: list[str] = []
        params: list = []
        if start_date:
            conditions.append("last_run >= %s::date")
            params.append(start_date)
        if end_date:
            conditions.append("last_run < (%s::date + interval '1 day')")
            params.append(end_date)
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        cur.execute(f"SELECT * FROM cert_schedules {where} ORDER BY created_at DESC", params)
        return [_serialize_schedule(dict(r)) for r in cur.fetchall()]


@router.post("/api/schedules")
def create_schedule(req: ScheduleCreate) -> dict:
    """Create a new certification schedule.

    Args:
        req: ScheduleCreate with name, cron, optional brand_filter and enabled flag.

    Returns:
        Created schedule dict.

    Raises:
        HTTPException: 500 if database not configured.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        schedule_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO cert_schedules (id, name, cron_expression, brand_filter, enabled) VALUES (%s, %s, %s, %s, %s) RETURNING *",
            [schedule_id, req.name, req.cron, req.brand_filter, req.enabled],
        )
        row = _serialize_schedule(dict(cur.fetchone()))
    load_schedules_into_scheduler()
    return row


@router.put("/api/schedules/{schedule_id}")
def update_schedule(schedule_id: str, req: ScheduleUpdate) -> dict:
    """Update an existing schedule.

    Args:
        schedule_id: UUID of the schedule.
        req: ScheduleUpdate with optional fields to change.

    Returns:
        Updated schedule dict.

    Raises:
        HTTPException: 400 if no fields provided, 404 if not found.
    """
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
        result = _serialize_schedule(dict(row))
    load_schedules_into_scheduler()
    return result


@router.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: str) -> dict:
    """Delete a schedule.

    Args:
        schedule_id: UUID of the schedule.

    Returns:
        {'ok': True}

    Raises:
        HTTPException: 404 if not found.
    """
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("DELETE FROM cert_schedules WHERE id = %s", [schedule_id])
        if cur.rowcount == 0:
            raise HTTPException(404, "Schedule not found")
    load_schedules_into_scheduler()
    return {"ok": True}


@router.post("/api/schedules/{schedule_id}/run")
def run_schedule_now(schedule_id: str) -> dict:
    """Trigger an immediate run of a schedule.

    Args:
        schedule_id: UUID of the schedule to run.

    Returns:
        Dict with run_id and status='running'.

    Raises:
        HTTPException: 404 if not found.
    """
    from app.routes.certifications import _run_validation, _running_validations, cleanup_old_validations

    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_schedules WHERE id = %s", [schedule_id])
        schedule = cur.fetchone()
        if not schedule:
            raise HTTPException(404, "Schedule not found")

        run_id = str(uuid.uuid4())
        brand = schedule["brand_filter"]
        cur.execute(
            "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
            [run_id, brand],
        )
        now = datetime.now(timezone.utc)
        cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])

    cleanup_old_validations()
    _running_validations[run_id] = {
        "status": "running", "events": [], "processed": 0, "total": 0, "_started_at": time.time()
    }
    threading.Thread(target=_run_validation, args=(run_id, brand, None, "sheets"), daemon=True).start()

    try:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_schedule_history (schedule_id, status) VALUES (%s, 'running')",
                [schedule_id],
            )
    except Exception:
        pass

    return {"run_id": run_id, "status": "running"}


@router.get("/api/schedules/{schedule_id}/history")
def get_schedule_history(schedule_id: str) -> list:
    """Get run history for a schedule.

    Args:
        schedule_id: UUID of the schedule.

    Returns:
        List of history entry dicts (last 20 runs).
    """
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        cur.execute(
            "SELECT * FROM cert_schedule_history WHERE schedule_id = %s ORDER BY run_date DESC LIMIT 20",
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

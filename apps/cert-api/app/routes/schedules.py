"""Certification schedule management routes."""

import json
import threading
import time
import uuid
from datetime import UTC, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, HTTPException, Query

from app.config import DATABASE_URL
from app.db.postgres import db
from app.models.schemas import CRON_VALIDATION_ERROR, ScheduleCreate, ScheduleUpdate, normalize_cron_expression
from app.utils.cron import build_cron_trigger
from app.utils.logging import log

router = APIRouter()

scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")


def _open_schedule_history(schedule_id: str) -> str | None:
    """Abre a linha 'running' do historico e devolve o id dela.

    Returns:
        O id da linha criada, para que o fechamento mire ESSA linha.
    """
    with db() as (conn, cur):
        cur.execute(
            "INSERT INTO cert_schedule_history (schedule_id, status) VALUES (%s, 'running') RETURNING id",
            [schedule_id],
        )
        row = cur.fetchone()
        return str(row["id"]) if row else None


def _close_schedule_history(
    schedule_id: str, status: str, summary: dict | None = None, history_id: str | None = None
) -> None:
    """Fecha a linha de historico com o status final.

    A interface pinta qualquer status != 'completed' como falha, entao uma linha
    deixada em 'running' vira erro permanente na tela. Todo caminho que abre o
    historico (agendado E manual) precisa fecha-lo.

    Args:
        history_id: linha exata a fechar. Sem ele o fallback fecha a ultima
            'running' do agendamento — o que, com um run manual e um agendado em
            voo ao mesmo tempo, fecharia a linha do outro e deixaria a propria
            pendurada.
    """
    with db() as (conn, cur):
        summary_json = json.dumps(summary) if summary is not None else None
        if history_id:
            cur.execute(
                "UPDATE cert_schedule_history SET status = %s, summary = COALESCE(%s::jsonb, summary) WHERE id = %s",
                [status, summary_json, history_id],
            )
            return
        cur.execute(
            """UPDATE cert_schedule_history SET status = %s, summary = COALESCE(%s::jsonb, summary)
               WHERE id = (
                 SELECT id FROM cert_schedule_history
                 WHERE schedule_id = %s AND status = 'running'
                 ORDER BY run_date DESC LIMIT 1
               )""",
            [status, summary_json, schedule_id],
        )


def _summarize_run(run_id: str) -> dict:
    """Resume os eventos de um run em contagens por status."""
    from app.routes.certifications import _running_validations

    state = _running_validations.get(run_id, {})
    events = state.get("events", [])
    return {
        "total": state.get("total", 0),
        "ok": sum(1 for e in events if e.get("product", {}).get("status") == "OK"),
        "inconsistent": sum(1 for e in events if e.get("product", {}).get("status") == "INCONSISTENT"),
        "not_found": sum(1 for e in events if e.get("product", {}).get("status") not in ("OK", "INCONSISTENT")),
    }


def _run_final_status(run_id: str) -> str:
    """'completed' ou 'failed' conforme o estado real do run.

    `_run_validation` engole a excecao e registra o erro no proprio state; sem
    consultar o state, um run que quebrou seria gravado como 'completed'.
    """
    from app.routes.certifications import _running_validations

    return "failed" if _running_validations.get(run_id, {}).get("status") == "error" else "completed"


def _refresh_next_run(schedule_id: str) -> None:
    """Recalcula e grava `next_run` depois de um disparo.

    `load_schedules_into_scheduler` so roda em create/update/delete e no boot;
    sem esta atualizacao a tela mostra uma "Proxima execucao" que ja passou desde
    o primeiro disparo do job.
    """
    try:
        job = scheduler.get_job(f"cert_schedule_{schedule_id}")
        if job is None:
            return
        next_run = job.trigger.get_next_fire_time(None, datetime.now(UTC))
        if next_run:
            with db() as (conn, cur):
                cur.execute("UPDATE cert_schedules SET next_run = %s WHERE id = %s", [next_run, schedule_id])
    except Exception as e:
        log.warning(f"Failed to refresh next_run for schedule {schedule_id}: {e}")


def _run_manual_schedule(
    schedule_id: str, run_id: str, brand_filter: str | None, history_id: str | None = None
) -> None:
    """Worker do "Executar agora": roda a validacao e FECHA a linha de historico.

    O caminho manual precisa devolver o `run_id` imediatamente para a UI
    acompanhar o progresso, entao nao pode simplesmente reusar
    `_execute_schedule` (que cria o proprio run_id e roda sincrono). O que ele
    reusa e o fechamento do historico — sem isso toda execucao manual ficava
    eternamente em 'running' e a tela pintava como falha.
    """
    from app.routes.certifications import _run_validation

    try:
        _run_validation(run_id, brand_filter, None, "sheets")
        summary = _summarize_run(run_id)
        status = _run_final_status(run_id)
        _close_schedule_history(schedule_id, status, summary, history_id)
        log.info(f"Manual run of schedule {schedule_id} finished ({status}): {summary}")
    except Exception as e:
        log.error(f"Manual run of schedule {schedule_id} failed: {e}")
        try:
            _close_schedule_history(schedule_id, "failed", None, history_id)
        except Exception:
            pass


def _execute_schedule(schedule_id: str, brand_filter: str | None) -> None:
    """Execute a scheduled validation run.

    Args:
        schedule_id: UUID string of the cert_schedules row.
        brand_filter: Optional brand to restrict to.
    """
    # Import here to avoid circular dependency at module load time
    from app.routes.certifications import _run_validation, _running_validations

    log.info(f"Scheduler executing schedule {schedule_id} (brand={brand_filter})")
    history_id: str | None = None
    try:
        run_id = str(uuid.uuid4())
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_validation_runs (id, status, brand_filter) VALUES (%s, 'running', %s)",
                [run_id, brand_filter],
            )
            now = datetime.now(UTC)
            cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])
        history_id = _open_schedule_history(schedule_id)

        _running_validations[run_id] = {
            "status": "running", "events": [], "processed": 0, "total": 0, "_started_at": time.time()
        }
        _run_validation(run_id, brand_filter, None, "sheets")

        summary = _summarize_run(run_id)
        status = _run_final_status(run_id)
        _close_schedule_history(schedule_id, status, summary, history_id)
        log.info(f"Schedule {schedule_id} finished ({status}): {summary}")
    except Exception as e:
        log.error(f"Schedule {schedule_id} failed: {e}")
        try:
            _close_schedule_history(schedule_id, "failed", None, history_id)
        except Exception:
            pass
    finally:
        _refresh_next_run(schedule_id)


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

        for s in schedules:
            cron_expr = s["cron_expression"]
            try:
                cron_expr = normalize_cron_expression(cron_expr)
            except ValueError:
                log.warning(f"Invalid cron for schedule {s['id']}: {cron_expr}")
                continue
            try:
                # `build_cron_trigger` traduz o dia-da-semana de crontab
                # (0=domingo) para a convencao do APScheduler (0=segunda). Sem
                # isso todo agendamento semanal disparava um dia depois do que a
                # interface promete (ver app/utils/cron.py).
                trigger = build_cron_trigger(cron_expr)
                scheduler.add_job(
                    _execute_schedule,
                    trigger=trigger,
                    id=f"cert_schedule_{s['id']}",
                    args=[str(s["id"]), s.get("brand_filter")],
                    replace_existing=True,
                    max_instances=1,
                )
                next_run = trigger.get_next_fire_time(None, datetime.now(UTC))
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

    O filtro start_date/end_date e sobre o HISTORICO de execucao (`last_run`),
    nao sobre a existencia do agendamento: um agendamento que nunca rodou
    (`last_run IS NULL`) entra em QUALQUER intervalo. Excluir esses fazia a tela
    dizer "Nenhum agendamento configurado" para agendamentos recem-criados que
    existiam e estavam ativos.

    Returns:
        List of schedule dicts.
    """
    if not DATABASE_URL:
        return []
    with db() as (conn, cur):
        conditions: list[str] = []
        params: list = []
        if start_date:
            conditions.append("(last_run >= %s::date OR last_run IS NULL)")
            params.append(start_date)
        if end_date:
            conditions.append("(last_run < (%s::date + interval '1 day') OR last_run IS NULL)")
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
    try:
        cron = normalize_cron_expression(req.cron)
    except ValueError as exc:
        raise HTTPException(400, str(exc) or CRON_VALIDATION_ERROR) from exc
    if not DATABASE_URL:
        raise HTTPException(500, "Database not configured")
    with db() as (conn, cur):
        schedule_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO cert_schedules (id, name, cron_expression, brand_filter, enabled) VALUES (%s, %s, %s, %s, %s) RETURNING *",
            [schedule_id, req.name, cron, req.brand_filter, req.enabled],
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
    cron = None
    if req.cron is not None:
        try:
            cron = normalize_cron_expression(req.cron)
        except ValueError as exc:
            raise HTTPException(400, str(exc) or CRON_VALIDATION_ERROR) from exc
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
            params.append(cron)
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
    from app.routes.certifications import (
        _running_validations,
        cleanup_old_validations,
    )

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
        now = datetime.now(UTC)
        cur.execute("UPDATE cert_schedules SET last_run = %s WHERE id = %s", [now, schedule_id])

    cleanup_old_validations()
    _running_validations[run_id] = {
        "status": "running", "events": [], "processed": 0, "total": 0, "_started_at": time.time()
    }

    # O historico e aberto ANTES da thread: se abrisse depois, um run curto podia
    # terminar e tentar fechar uma linha que ainda nao existia.
    history_id: str | None = None
    try:
        history_id = _open_schedule_history(schedule_id)
    except Exception as e:
        log.warning(f"Failed to open history for manual run of schedule {schedule_id}: {e}")

    threading.Thread(
        target=_run_manual_schedule, args=(schedule_id, run_id, brand, history_id), daemon=True
    ).start()

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

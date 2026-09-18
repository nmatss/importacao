"""Rotas da auditoria de marketplace (quebra-cabecas de sellers terceiros)."""

import threading
import time

from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import DATABASE_URL
from app.db.postgres import db
from app.services.marketplace_audit import (
    DEFAULT_CATEGORY_PATH,
    DEFAULT_PIECES_THRESHOLD,
    is_valid_category_path,
    run_audit,
)
from app.utils.logging import log

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# Estado em memoria das auditorias em andamento, no mesmo padrao de
# `_running_validations`: a leitura da VTEX pagina com o delay padrao e nao cabe
# num request sincrono sem arriscar o timeout do proxy.
_running_audits: dict[str, dict] = {}

_MAX_TRACKED_AUDITS = 20


def _remember(run_id: str, state: dict) -> None:
    """Guarda o estado do run e descarta os mais antigos (memoria limitada)."""
    _running_audits[run_id] = state
    while len(_running_audits) > _MAX_TRACKED_AUDITS:
        _running_audits.pop(next(iter(_running_audits)))


def _run_audit_worker(run_id: str, category_path: str, threshold: int) -> None:
    state = _running_audits[run_id]
    try:
        result = run_audit(category_path=category_path, threshold=threshold)
        state.update(
            status="completed",
            summary=result["summary"],
            total=result["total"],
            scanned=result["scanned"],
            # O run_id que vale para consultar os itens e o gerado pelo servico.
            result_run_id=result["run_id"],
        )
    except Exception as e:
        log.error(f"Marketplace audit {run_id} failed: {type(e).__name__}")
        state.update(status="error", error=type(e).__name__)
    finally:
        state["finished_at"] = time.time()


@router.post("/api/marketplace/audit")
@limiter.limit("5/minute")
def start_marketplace_audit(
    request: Request,
    category: str = Query(DEFAULT_CATEGORY_PATH, max_length=200),
    threshold: int = Query(DEFAULT_PIECES_THRESHOLD, ge=1, le=100000),
) -> dict:
    """Dispara a auditoria em segundo plano.

    Returns:
        `{'run_id': ..., 'status': 'running'}`.

    Raises:
        HTTPException: 400 quando `category` nao cabe na allow-list. O valor vem
            do usuario e vira PATH da URL lida pelo servidor: sem isto,
            `../../admin` ou `a?b=c` escolheriam outro endpoint do site.
    """
    import uuid

    if not is_valid_category_path(category):
        raise HTTPException(400, "Categoria invalida")

    run_id = str(uuid.uuid4())
    _remember(run_id, {"status": "running", "started_at": time.time()})
    threading.Thread(
        target=_run_audit_worker, args=(run_id, category, threshold), daemon=True
    ).start()
    return {"run_id": run_id, "status": "running"}


@router.get("/api/marketplace/audit/{run_id}")
def get_marketplace_audit(run_id: str) -> dict:
    """Estado de uma auditoria disparada nesta instancia.

    Raises:
        HTTPException: 404 quando o run nao existe (ou ja foi descartado).
    """
    state = _running_audits.get(run_id)
    if not state:
        raise HTTPException(404, "Auditoria nao encontrada")
    return {"run_id": run_id, **state}


@router.get("/api/marketplace/items")
def list_marketplace_items(
    verdict: str = Query(""),
    seller: str = Query(""),
    run_id: str = Query(""),
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    """Itens da ULTIMA auditoria (ou de `run_id`, quando informado).

    Sem recortar por execucao, a tela misturaria a leitura de hoje com a de
    semanas atras e mostraria como "nao conforme" um item ja corrigido.

    Returns:
        `{'items': [...], 'run_id': ..., 'checked_at': ..., 'summary': {...}}`.
    """
    empty = {"items": [], "run_id": None, "checked_at": None, "summary": {}}
    if not DATABASE_URL:
        return empty

    with db() as (conn, cur):
        target = run_id
        if not target:
            cur.execute(
                "SELECT run_id FROM cert_marketplace_items "
                "WHERE run_id IS NOT NULL ORDER BY checked_at DESC LIMIT 1"
            )
            row = cur.fetchone()
            if not row:
                return empty
            target = row["run_id"]

        conditions = ["run_id = %s"]
        params: list = [target]
        if verdict:
            conditions.append("verdict = ANY(%s)")
            params.append([v.strip().upper() for v in verdict.split(",") if v.strip()])
        if seller:
            conditions.append("(seller_id = %s OR seller_name ILIKE %s)")
            params.extend([seller, f"%{seller}%"])
        where = "WHERE " + " AND ".join(conditions)

        cur.execute(
            f"SELECT * FROM cert_marketplace_items {where} "  # noqa: S608
            "ORDER BY verdict, name LIMIT %s",
            params + [limit],
        )
        items = []
        checked_at = None
        for r in cur.fetchall():
            item = dict(r)
            item["id"] = str(item["id"])
            if item.get("checked_at") is not None and hasattr(item["checked_at"], "isoformat"):
                item["checked_at"] = item["checked_at"].isoformat()
            checked_at = checked_at or item.get("checked_at")
            items.append(item)

        # O resumo cobre a execucao inteira, nao a pagina: com `verdict` no
        # filtro, contar os itens devolvidos daria sempre 100% do veredito
        # filtrado.
        cur.execute(
            "SELECT verdict, COUNT(*) AS cnt FROM cert_marketplace_items "
            "WHERE run_id = %s GROUP BY verdict",
            [target],
        )
        summary = {r["verdict"]: r["cnt"] for r in cur.fetchall()}

    return {"items": items, "run_id": target, "checked_at": checked_at, "summary": summary}

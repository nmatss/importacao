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
    MarketplaceAuditError,
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

# K9 (single-flight): o estado e em memoria e a API roda em processo unico do
# uvicorn, entao um lock de modulo basta para "checar e reservar" de forma
# atomica. Dois cliques ou duas abas nao podem disparar leituras concorrentes
# contra o site da loja. Se um dia houver mais de um worker, isto precisa virar
# advisory lock no Postgres.
_audit_lock = threading.Lock()
# Pior caso de uma execucao: 20 paginas x (3 tentativas x 25s + 6s de backoff)
# ~ 27 min. Depois de 1h um run ainda "running" e thread travada, e nao pode
# bloquear a auditoria para sempre.
_STALE_RUN_SECONDS = 3600


def _remember(run_id: str, state: dict) -> None:
    """Guarda o estado do run e descarta os mais antigos (memoria limitada)."""
    _running_audits[run_id] = state
    while len(_running_audits) > _MAX_TRACKED_AUDITS:
        _running_audits.pop(next(iter(_running_audits)))


def _active_run_id(now: float) -> str | None:
    """Id da auditoria em andamento, ou None. Chamar com `_audit_lock` tomado.

    Run "running" ha mais de `_STALE_RUN_SECONDS` e marcado como erro aqui.
    """
    for run_id, state in _running_audits.items():
        if state.get("status") != "running":
            continue
        if now - float(state.get("started_at") or 0) > _STALE_RUN_SECONDS:
            log.error(f"Marketplace audit {run_id} travada; liberando o single-flight")
            state.update(status="error", error="StaleRun", finished_at=now)
            continue
        return run_id
    return None


def _run_audit_worker(
    run_id: str, category_path: str, threshold: int = DEFAULT_PIECES_THRESHOLD
) -> None:
    state = _running_audits[run_id]
    try:
        result = run_audit(category_path=category_path, threshold=threshold)
        state.update(
            status="completed",
            summary=result["summary"],
            total=result["total"],
            scanned=result["scanned"],
            unverified=result.get("unverified", 0),
            # O run_id que vale para consultar os itens e o gerado pelo servico.
            result_run_id=result["run_id"],
        )
    except MarketplaceAuditError as e:
        # Mensagem escrita por nos (ex.: categoria vazia): pode ir para a tela.
        log.error(f"Marketplace audit {run_id} failed: {type(e).__name__}")
        state.update(status="error", error=type(e).__name__, message=str(e))
    except Exception as e:
        # Excecao inesperada pode carregar URL/SQL: so o tipo sai daqui.
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
            409 quando ja ha uma auditoria em andamento (single-flight).
            503 quando a thread de leitura nao pode ser criada.
    """
    import uuid

    if not is_valid_category_path(category):
        raise HTTPException(400, "Categoria invalida")

    run_id = str(uuid.uuid4())
    with _audit_lock:
        now = time.time()
        active = _active_run_id(now)
        if active:
            raise HTTPException(
                409, "Já existe uma auditoria em andamento. Aguarde ela terminar."
            )
        _remember(run_id, {"status": "running", "started_at": now})
    try:
        threading.Thread(
            target=_run_audit_worker, args=(run_id, category, threshold), daemon=True
        ).start()
    except Exception as e:
        # Sem thread nao ha `finally` do worker: sem isto o run ficaria
        # "running" e bloquearia o single-flight ate o corte de 1h.
        log.error(f"Marketplace audit {run_id} nao iniciou: {type(e).__name__}")
        _running_audits[run_id].update(
            status="error", error=type(e).__name__, finished_at=time.time()
        )
        raise HTTPException(503, "Nao foi possivel iniciar a auditoria") from None
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
        for r in cur.fetchall():
            item = dict(r)
            item["id"] = str(item["id"])
            if item.get("checked_at") is not None and hasattr(item["checked_at"], "isoformat"):
                item["checked_at"] = item["checked_at"].isoformat()
            items.append(item)

        # K8: a data e da EXECUCAO, nao da pagina filtrada. Tirada dos itens
        # devolvidos, um filtro sem resultado ("Conforme (0)") zerava a data e a
        # tela mandava rodar uma auditoria que ja tinha rodado.
        cur.execute(
            "SELECT MAX(checked_at) AS checked_at FROM cert_marketplace_items "
            "WHERE run_id = %s",
            [target],
        )
        run_row = cur.fetchone()
        checked_at = run_row.get("checked_at") if run_row else None
        if checked_at is not None and hasattr(checked_at, "isoformat"):
            checked_at = checked_at.isoformat()

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

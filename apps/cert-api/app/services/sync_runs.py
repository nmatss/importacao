"""Execucoes do sync da planilha: lock compartilhado e historico (cert_sync_runs).

Ate 2026-09-11 o sync da planilha rodava por tres caminhos independentes — o
startup, a validacao diaria (`source='sheets'`) e o endpoint manual
`POST /api/sync-sheets` — sem nenhuma coordenacao entre eles e sem deixar
registro. Duas consequencias medidas na reuniao de 11/09:

- ninguem sabia dizer QUANDO a planilha foi lida pela ultima vez nem por quem
  (a tela so mostrava a ultima validacao de VTEX);
- dois syncs simultaneos disputavam o mesmo UPSERT/limpeza em `cert_products`.

Este modulo resolve os dois: um lock advisory de sessao compartilhado por todos
os caminhos e uma linha por execucao em `cert_sync_runs` (decisao D11).
"""

import json
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime

from app.config import DATABASE_URL
from app.db.postgres import db, get_conn, put_conn
from app.utils.logging import log

# Chave do `pg_try_advisory_lock`. Constante arbitraria porem ESTAVEL: mudar o
# valor faz um processo antigo e um novo deixarem de se enxergar.
SHEET_SYNC_LOCK_KEY = 776_120_911

# Valores aceitos pelo CHECK de `cert_sync_runs.trigger` (ver db/postgres.py).
SYNC_TRIGGERS = ("manual", "startup", "schedule", "hourly")

# Resumo da execucao quando a planilha e recusada. O motivo acionavel (aba,
# cabecalho, SKU) fica em `result.sheets.error`; aqui so se diz o que aconteceu
# com cada etapa.
_SHEETS_FAILED_LINX_OK = "Sincronizacao da planilha falhou; leitura do Linx concluida"
_SHEETS_FAILED_LINX_FAILED = "Sincronizacao da planilha falhou; leitura do Linx tambem falhou ou ficou incompleta"


@contextmanager
def sheet_sync_lock(lock_key: int = SHEET_SYNC_LOCK_KEY) -> Generator[bool, None, None]:
    """Tenta tomar um lock de operacao (padrao: sync) e o devolve ao sair.

    O lock e de SESSAO (`pg_try_advisory_lock`), nao de transacao: o sync faz
    varias transacoes curtas com `db()`, e um lock de transacao morreria na
    primeira delas. Por isso a conexao e emprestada do pool e segurada ate o
    fim do bloco.

    Yields:
        True quando o lock foi obtido (o chamador pode sincronizar), False
        quando outra execucao ja esta em andamento.
    """
    if not DATABASE_URL:
        # Sem banco nao ha lock nem historico, mas o sync da planilha em si
        # continua funcionando: exigir Postgres aqui transformaria uma melhoria
        # de coordenacao em regressao para quem roda so com o Sheets.
        yield True
        return

    conn = get_conn()
    acquired = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s) AS locked", [lock_key])
            row = cur.fetchone()
            acquired = bool(row and row[0])
        conn.commit()
        yield acquired
    finally:
        if acquired:
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", [lock_key])
                conn.commit()
            except Exception as e:
                # A conexao volta ao pool mesmo assim; o lock cai sozinho quando
                # ela for reciclada ou o processo terminar.
                log.warning(f"Could not release sheet sync lock: {e}")
        try:
            put_conn(conn)
        except Exception as e:
            log.warning(f"Could not return sheet sync connection to the pool: {e}")


def start_sync_run(trigger: str, actor: str | None = None) -> str | None:
    """Abre a linha de `cert_sync_runs` desta execucao.

    Args:
        trigger: um de `SYNC_TRIGGERS`.
        actor: e-mail do operador (so no disparo manual).

    Returns:
        O id da linha, ou None quando o registro falhou — o sync NUNCA deixa de
        rodar por causa do historico.
    """
    if trigger not in SYNC_TRIGGERS:
        raise ValueError(f"trigger invalido: {trigger!r}")
    if not DATABASE_URL:
        return None
    try:
        with db() as (conn, cur):
            cur.execute(
                "INSERT INTO cert_sync_runs (trigger, actor) VALUES (%s, %s) RETURNING id",
                [trigger, actor or None],
            )
            row = cur.fetchone()
            return str(row["id"]) if row else None
    except Exception as e:
        log.warning(f"Could not open cert_sync_runs row ({trigger}): {e}")
        return None


def finish_sync_run(run_id: str | None, result: dict | None = None, error: str | None = None) -> None:
    """Fecha a linha aberta por `start_sync_run`.

    Uma linha deixada sem `finished_at` seria lida pela tela como "sincronizando
    agora" para sempre, entao todo caminho de saida — inclusive o de excecao —
    passa por aqui.
    """
    if not run_id:
        return
    try:
        with db() as (conn, cur):
            cur.execute(
                "UPDATE cert_sync_runs SET finished_at = %s, result = %s::jsonb, error = %s WHERE id = %s",
                [
                    datetime.now(UTC),
                    json.dumps(result, ensure_ascii=False, default=str) if result is not None else None,
                    error,
                    run_id,
                ],
            )
    except Exception as e:
        log.warning(f"Could not close cert_sync_runs row {run_id}: {e}")


def serialize_sync_run(row: dict) -> dict:
    """Converte uma linha de `cert_sync_runs` para tipos JSON."""
    out = dict(row)
    out["id"] = str(out["id"])
    for field in ("started_at", "finished_at"):
        value = out.get(field)
        if value is not None and hasattr(value, "isoformat"):
            out[field] = value.isoformat()
    return out


def fetch_last_sync_run() -> dict | None:
    """Ultima execucao registrada (por `started_at`), ou None."""
    with db() as (conn, cur):
        cur.execute("SELECT * FROM cert_sync_runs ORDER BY started_at DESC LIMIT 1")
        row = cur.fetchone()
        return serialize_sync_run(dict(row)) if row else None


def run_sheet_sync(trigger: str, actor: str | None = None) -> dict:
    """Roda o sync da planilha (+ atributos do Linx) sob o lock compartilhado.

    Caminho unico dos quatro gatilhos — botao, startup, validacao agendada e job
    horario —, para que dois nunca escrevam em `cert_products` ao mesmo tempo.

    O sync do Linx roda DEPOIS do da planilha e a falha dele NAO derruba a
    execucao: a planilha ja foi aplicada e "Linx indisponivel" e um estado
    proprio, nao "produto sem licenciamento".

    Returns:
        Dict com `sheets`, `linx`, `trigger`, `run_id` e `locked` (False quando
        outra execucao ja estava em andamento — nada foi feito).
    """
    from app.services.erp_service import sync_sheets_to_db
    from app.services.linx_attributes import sync_linx_attributes

    with sheet_sync_lock() as acquired:
        if not acquired:
            return {"locked": False, "trigger": trigger, "run_id": None}

        run_id = start_sync_run(trigger, actor)
        result: dict = {"locked": True, "trigger": trigger, "run_id": run_id}
        try:
            result["sheets"] = sync_sheets_to_db()
        except Exception as e:
            finish_sync_run(run_id, None, f"{type(e).__name__}: {e}")
            raise

        # A leitura do Linx roda MESMO com a planilha em erro: ela so depende dos
        # SKUs ja gravados em `cert_products`, e a planilha que falha nao grava
        # nada (retorna antes ou faz rollback). Enquanto as duas etapas estavam
        # amarradas (12 a 18/09/2026), seis dias de planilha recusada deixaram
        # licenciamento, grife e fim de vendas sem NENHUMA leitura.
        try:
            result["linx"] = sync_linx_attributes()
        except Exception as e:
            log.warning(f"Linx attribute sync failed during {trigger} sync: {type(e).__name__}")
            result["linx"] = {"error": type(e).__name__}

        sheets_failed = bool(result["sheets"].get("error"))
        linx_failed = bool(result["linx"].get("error") or result["linx"].get("errors"))
        result["status"] = "error" if (sheets_failed or linx_failed) else "completed"
        if sheets_failed:
            result["error"] = _SHEETS_FAILED_LINX_FAILED if linx_failed else _SHEETS_FAILED_LINX_OK
        elif linx_failed:
            result["error"] = "Atualizacao parcial: planilha aplicada, mas a leitura do Linx falhou ou ficou incompleta"
        finish_sync_run(run_id, {"sheets": result["sheets"], "linx": result["linx"]}, result.get("error"))
        return result


def snapshot_sync_warning() -> str | None:
    """Aviso do snapshot sem inferir atualidade por prazo arbitrario."""
    if not DATABASE_URL:
        return "Atualidade das fontes nao verificada; relatorio baseado no snapshot disponivel"
    try:
        last = fetch_last_sync_run()
    except Exception:
        return "Historico de sincronizacao indisponivel; relatorio baseado no snapshot anterior"
    if not last:
        return "Sem sincronizacao registrada; atualidade das fontes nao verificada"
    result = last.get("result") or {}
    if (
        last.get("error")
        or result.get("sheets", {}).get("error")
        or result.get("linx", {}).get("error")
        or result.get("linx", {}).get("errors")
    ):
        if result.get("sheets", {}).get("error"):
            return "Ultima sincronizacao da planilha falhou; dados de certificacao sao os do ultimo sync bom, atualidade nao confirmada"
        return "Ultima sincronizacao incompleta; pode haver dados atualizados parcialmente, atualidade conjunta nao confirmada"
    if not last.get("finished_at"):
        return "Sincronizacao ainda em andamento; dados podem estar atualizados parcialmente"
    return None

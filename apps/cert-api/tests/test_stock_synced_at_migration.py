"""Migracao de `cert_stock.synced_at` para TIMESTAMPTZ.

A coluna nasceu `timestamp` sem time zone enquanto os dois caminhos de escrita
gravam UTC (`datetime.now(UTC).isoformat()` no wms_service e o `DEFAULT NOW()`
avaliado num Postgres sem `TZ`). Sem sufixo de fuso, o navegador lia o valor como
horario LOCAL e a tela mostrava o sync 3 horas ADIANTE do horario de Brasilia.

Estes testes fixam o contrato da conversao: ela roda uma unica vez, so quando a
coluna ainda e naive, e nunca deixa o startup cair.
"""

from contextlib import contextmanager

import pytest

from app.db import postgres

NAIVE = "timestamp without time zone"
AWARE = "timestamp with time zone"


class _FakeCursor:
    """Cursor que responde ao `information_schema` e registra os ALTER emitidos."""

    def __init__(self, state: dict):
        self._state = state
        self._last_row: dict | None = None

    def execute(self, sql: str, params=None) -> None:
        norm = " ".join(sql.split())
        self._state["statements"].append(norm)
        if "information_schema.columns" in norm:
            self._last_row = (
                {"data_type": self._state["data_type"]}
                if self._state["data_type"] is not None
                else None
            )
        elif norm.startswith("ALTER TABLE cert_stock"):
            if self._state.get("alter_error"):
                raise self._state["alter_error"]
            self._state["alters"].append(norm)
            # O banco real passa a reportar o novo tipo a partir daqui — e o que
            # torna a segunda execucao um no-op.
            self._state["data_type"] = AWARE
        else:
            self._last_row = None

    def fetchone(self) -> dict | None:
        return self._last_row


def _install_fake_db(mocker, data_type: str | None, alter_error: Exception | None = None) -> dict:
    """Troca `db()` por um duplo com estado; devolve o dict de estado."""
    state: dict = {
        "data_type": data_type,
        "alter_error": alter_error,
        "statements": [],
        "alters": [],
    }

    @contextmanager
    def fake_db():
        yield (mocker.MagicMock(), _FakeCursor(state))

    mocker.patch.object(postgres, "db", fake_db)
    return state


def test_converts_naive_column_reinterpreting_values_as_utc(mocker):
    """Coluna naive: emite o ALTER com `AT TIME ZONE 'UTC'`, nao outro fuso."""
    state = _install_fake_db(mocker, NAIVE)

    postgres._migrate_stock_synced_at_to_timestamptz()

    assert len(state["alters"]) == 1
    alter = state["alters"][0]
    assert "ALTER COLUMN synced_at TYPE TIMESTAMPTZ" in alter
    # O fuso da conversao e o contrato: os dois caminhos de escrita gravam UTC.
    assert "USING synced_at AT TIME ZONE 'UTC'" in alter


def test_is_idempotent_across_restarts(mocker):
    """Rodar duas vezes (dois startups) converte uma unica vez e nao estoura."""
    state = _install_fake_db(mocker, NAIVE)

    postgres._migrate_stock_synced_at_to_timestamptz()
    postgres._migrate_stock_synced_at_to_timestamptz()

    assert len(state["alters"]) == 1, "a segunda subida nao pode reconverter a coluna"
    assert state["data_type"] == AWARE


def test_does_not_run_when_column_is_already_timestamptz(mocker):
    """Base nova (ou ja migrada): consulta o tipo e para, sem tocar na tabela."""
    state = _install_fake_db(mocker, AWARE)

    postgres._migrate_stock_synced_at_to_timestamptz()

    assert state["alters"] == []
    assert not any(s.startswith("ALTER TABLE") for s in state["statements"])
    # Ainda assim consultou o information_schema — e assim que ela decide.
    assert any("information_schema.columns" in s for s in state["statements"])


def test_does_nothing_when_column_or_table_is_absent(mocker):
    """Sem a coluna, nao ha o que converter e nada pode ser levantado."""
    state = _install_fake_db(mocker, None)

    postgres._migrate_stock_synced_at_to_timestamptz()

    assert state["alters"] == []


def test_failure_is_logged_and_does_not_block_startup(mocker):
    """Um ALTER recusado (lock, permissao) nao pode derrubar o startup."""
    state = _install_fake_db(mocker, NAIVE, alter_error=RuntimeError("lock timeout"))
    warn = mocker.patch.object(postgres.log, "warning")

    postgres._migrate_stock_synced_at_to_timestamptz()  # nao levanta

    assert state["alters"] == []
    assert warn.called


def test_ensure_tables_runs_the_migration(mocker):
    """A conversao precisa estar ligada ao startup, nao so existir no modulo."""
    mocker.patch.object(postgres, "db", _install_and_ignore(mocker))
    mocker.patch.object(postgres, "_add_column_if_not_exists")
    migrate = mocker.patch.object(postgres, "_migrate_stock_synced_at_to_timestamptz")

    postgres.ensure_tables()

    migrate.assert_called_once()


def test_new_databases_create_the_column_already_aware(mocker):
    """DDL de criacao: base nova nao pode nascer com a coluna naive de novo."""
    ddl: list[str] = []

    @contextmanager
    def fake_db():
        cur = mocker.MagicMock()
        cur.execute.side_effect = lambda sql, *a: ddl.append(" ".join(sql.split()))
        yield (mocker.MagicMock(), cur)

    mocker.patch.object(postgres, "db", fake_db)
    mocker.patch.object(postgres, "_add_column_if_not_exists")
    mocker.patch.object(postgres, "_migrate_stock_synced_at_to_timestamptz")

    postgres.ensure_tables()

    create_stock = [s for s in ddl if "CREATE TABLE IF NOT EXISTS cert_stock" in s]
    assert len(create_stock) == 1
    assert "synced_at TIMESTAMPTZ DEFAULT NOW()" in create_stock[0]


def _install_and_ignore(mocker):
    """`db()` inerte, para os testes que so olham a orquestracao do ensure_tables."""

    @contextmanager
    def fake_db():
        yield (mocker.MagicMock(), mocker.MagicMock())

    return fake_db


@pytest.mark.parametrize("data_type", [NAIVE, AWARE, None])
def test_never_raises_regardless_of_column_state(mocker, data_type):
    """Contrato geral: a migracao e best-effort e jamais propaga excecao."""
    _install_fake_db(mocker, data_type)
    postgres._migrate_stock_synced_at_to_timestamptz()

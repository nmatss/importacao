"""Testes dos agendamentos de certificacao.

O bloco mais importante e `TestCrontabDayOfWeekConvention`: ele congela o dia da
semana REAL em que cada preset da interface dispara. No APScheduler 3.x o
`day_of_week` numerico e 0=SEGUNDA (e `from_crontab` NAO converte), enquanto a
interface usa a convencao crontab 0=DOMINGO. Entregar o campo cru ao CronTrigger
fazia "Semanal (Segunda)" disparar na TERCA e "Semanal (Sexta)" no SABADO.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.models.schemas import normalize_cron_expression
from app.routes import schedules as schedules_module
from app.utils.cron import build_cron_trigger, crontab_dow_to_apscheduler

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
# Sabado, 29/08/2026 ao meio-dia: referencia fixa para os disparos serem
# deterministicos independentemente de quando a suite roda.
REFERENCE = datetime(2026, 8, 29, 12, 0, tzinfo=SAO_PAULO)

MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY = range(7)


@pytest.fixture(autouse=True)
def _clean_running_validations():
    """`_running_validations` e um dict de modulo — nao pode vazar entre testes."""
    from app.routes.certifications import _running_validations

    before = dict(_running_validations)
    yield
    _running_validations.clear()
    _running_validations.update(before)


def _next_fires(cron: str, count: int = 3) -> list[datetime]:
    """Proximos `count` disparos da expressao crontab, a partir de REFERENCE."""
    trigger = build_cron_trigger(cron)
    fires = []
    previous = None
    now = REFERENCE
    for _ in range(count):
        nxt = trigger.get_next_fire_time(previous, now)
        assert nxt is not None
        fires.append(nxt)
        previous = nxt
        now = nxt
    return fires


# ---------------------------------------------------------------------------
# BLOQUEADOR 1 — convencao de dia da semana
# ---------------------------------------------------------------------------


class TestCrontabDayOfWeekConvention:
    """Cada preset da interface tem de disparar no dia que o rotulo promete."""

    def test_preset_semanal_segunda_dispara_na_segunda(self):
        """'Semanal (Segunda)' = `0 6 * * 1` — antes disparava na TERCA."""
        for fire in _next_fires("0 6 * * 1"):
            assert fire.weekday() == MONDAY, f"{fire} nao e segunda-feira"
            assert (fire.hour, fire.minute) == (6, 0)

    def test_preset_semanal_sexta_dispara_na_sexta(self):
        """'Semanal (Sexta)' = `0 6 * * 5` — antes disparava no SABADO."""
        for fire in _next_fires("0 6 * * 5"):
            assert fire.weekday() == FRIDAY, f"{fire} nao e sexta-feira"
            assert (fire.hour, fire.minute) == (6, 0)

    def test_preset_diario_dispara_todo_dia_as_seis(self):
        """'Diario (06:00)' = `0 6 * * *`."""
        fires = _next_fires("0 6 * * *")
        assert [f.date().isoformat() for f in fires] == ["2026-08-30", "2026-08-31", "2026-09-01"]
        assert all((f.hour, f.minute) == (6, 0) for f in fires)

    def test_preset_mensal_dispara_no_dia_um(self):
        """'Mensal (Dia 1)' = `0 6 1 * *`."""
        for fire in _next_fires("0 6 1 * *"):
            assert fire.day == 1
            assert (fire.hour, fire.minute) == (6, 0)

    def test_domingo_zero_dispara_no_domingo(self):
        """Crontab `0` e DOMINGO (a tabela de nomes do frontend le 0=domingo)."""
        for fire in _next_fires("0 6 * * 0"):
            assert fire.weekday() == SUNDAY

    def test_domingo_sete_equivale_a_zero(self):
        """Crontab aceita `7` como domingo; o APScheduler cru rejeitaria."""
        for fire in _next_fires("0 6 * * 7"):
            assert fire.weekday() == SUNDAY

    def test_intervalo_dias_uteis(self):
        """`1-5` = segunda a sexta."""
        fires = _next_fires("0 6 * * 1-5", count=6)
        assert [f.weekday() for f in fires] == [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, MONDAY]

    def test_lista_de_dias(self):
        """`1,3,5` = segunda, quarta e sexta."""
        fires = _next_fires("0 6 * * 1,3,5", count=4)
        assert [f.weekday() for f in fires] == [MONDAY, WEDNESDAY, FRIDAY, MONDAY]

    def test_fim_de_semana_com_intervalo_que_da_a_volta(self):
        """`6-0` (sabado a domingo) da a volta na semana — o APScheduler nao aceita cru."""
        # REFERENCE e sabado ao meio-dia, logo o proximo disparo e o domingo.
        fires = _next_fires("0 6 * * 6-0", count=4)
        assert [f.weekday() for f in fires] == [SUNDAY, SATURDAY, SUNDAY, SATURDAY]


class TestCrontabDowTranslation:
    """Unidade da traducao do campo, com os casos de sintaxe que precisam sobreviver."""

    @pytest.mark.parametrize(
        ("crontab_field", "apscheduler_field"),
        [
            ("*", "*"),
            ("0", "6"),          # domingo
            ("1", "0"),          # segunda
            ("5", "4"),          # sexta
            ("6", "5"),          # sabado
            ("7", "6"),          # domingo (forma alternativa do crontab)
            ("1,3,5", "0,2,4"),
            ("1-5", "0,1,2,3,4"),
            ("0-6", "0,1,2,3,4,5,6"),
            ("*/2", "1,3,5,6"),  # crontab dom,ter,qui,sab
            ("6-0", "5,6"),      # intervalo que da a volta
        ],
    )
    def test_traducao(self, crontab_field, apscheduler_field):
        assert crontab_dow_to_apscheduler(crontab_field) == apscheduler_field

    def test_nomes_de_dia_passam_intactos(self):
        """`mon`/`fri` ja significam o mesmo dia nas duas convencoes."""
        assert crontab_dow_to_apscheduler("mon") == "mon"
        assert crontab_dow_to_apscheduler("mon-fri") == "mon-fri"

    def test_sintaxe_desconhecida_passa_intacta(self):
        """O que este parser nao entende segue para o APScheduler validar."""
        assert crontab_dow_to_apscheduler("xyz") == "xyz"


class TestCronValidation:
    """A validacao e o disparo usam o MESMO caminho — nao podem divergir."""

    def test_aceita_domingo_sete(self):
        assert normalize_cron_expression("0 6 * * 7") == "0 6 * * 7"

    def test_preserva_a_expressao_na_convencao_crontab(self):
        """A expressao guardada continua sendo a que a interface exibe."""
        assert normalize_cron_expression("  0   6 * * 1 ") == "0 6 * * 1"

    @pytest.mark.parametrize("bad", ["60 24 * * *", "*/0 * * * *", "0 6 * *", "0 6 * * 9", ""])
    def test_rejeita_invalidos(self, bad):
        with pytest.raises(ValueError):
            normalize_cron_expression(bad)


# ---------------------------------------------------------------------------
# Helpers de mock
# ---------------------------------------------------------------------------


def _recording_db(mocker):
    """Substitui `schedules.db` por um mock que registra (sql_normalizado, params)."""
    calls: list[tuple[str, object]] = []
    cur = mocker.MagicMock()
    cur.execute.side_effect = lambda sql, params=None: calls.append((" ".join(str(sql).split()), params))
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cur))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.schedules.db", return_value=ctx)
    return calls, cur


def _sql_matching(calls, *fragments):
    return [c for c in calls if all(f in c[0] for f in fragments)]


# ---------------------------------------------------------------------------
# ALTO 4 — "Executar agora" nao pode deixar historico em 'running'
# ---------------------------------------------------------------------------


class TestManualRunClosesHistory:
    def test_run_bem_sucedido_fecha_como_completed(self, mocker):
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)
        certifications._running_validations["run-ok"] = {
            "status": "completed", "total": 2, "events": [
                {"product": {"status": "OK"}}, {"product": {"status": "INCONSISTENT"}},
            ],
        }

        schedules_module._run_manual_schedule("sched-1", "run-ok", None)

        closes = _sql_matching(calls, "UPDATE cert_schedule_history SET status")
        assert len(closes) == 1
        assert closes[0][1][0] == "completed"
        assert '"ok": 1' in closes[0][1][1] and '"inconsistent": 1' in closes[0][1][1]

    def test_run_que_quebrou_fecha_como_failed(self, mocker):
        """`_run_validation` engole a excecao e marca o state — o historico tem de refletir."""
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)
        certifications._running_validations["run-err"] = {"status": "error", "total": 0, "events": []}

        schedules_module._run_manual_schedule("sched-1", "run-err", None)

        closes = _sql_matching(calls, "UPDATE cert_schedule_history SET status")
        assert closes and closes[0][1][0] == "failed"

    def test_fecha_a_linha_pelo_id_e_nao_a_ultima_running(self, mocker):
        """Um run manual e um agendado em voo ao mesmo tempo nao podem trocar de linha."""
        calls, cur = _recording_db(mocker)
        cur.fetchone.return_value = {"id": "hist-42"}
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)
        certifications._running_validations["run-ok"] = {"status": "completed", "total": 0, "events": []}

        history_id = schedules_module._open_schedule_history("sched-1")
        assert history_id == "hist-42"
        assert "RETURNING id" in _sql_matching(calls, "INSERT INTO cert_schedule_history")[0][0]

        calls.clear()
        schedules_module._run_manual_schedule("sched-1", "run-ok", None, history_id)

        closes = _sql_matching(calls, "UPDATE cert_schedule_history SET status")
        assert len(closes) == 1
        assert "WHERE id = %s" in closes[0][0]
        assert "ORDER BY run_date DESC" not in closes[0][0]
        assert closes[0][1][-1] == "hist-42"

    def test_sem_id_cai_no_fallback_da_ultima_running(self, mocker):
        """Se o INSERT nao devolveu id, o fechamento ainda acontece (nao deixa 'running')."""
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)
        certifications._running_validations["run-ok"] = {"status": "completed", "total": 0, "events": []}

        schedules_module._run_manual_schedule("sched-1", "run-ok", None, None)

        closes = _sql_matching(calls, "UPDATE cert_schedule_history SET status")
        assert len(closes) == 1
        assert "ORDER BY run_date DESC" in closes[0][0]

    def test_excecao_no_worker_fecha_como_failed(self, mocker):
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        def _boom(*a, **k):
            raise RuntimeError("boom")

        mocker.patch.object(certifications, "_run_validation", _boom)

        schedules_module._run_manual_schedule("sched-1", "run-boom", None)

        closes = _sql_matching(calls, "UPDATE cert_schedule_history SET status")
        assert closes and closes[0][1][0] == "failed"

    @pytest.mark.asyncio
    async def test_endpoint_abre_historico_antes_de_iniciar_a_thread(
        self, test_client, api_key_headers, mocker
    ):
        """A rota tem de delegar ao worker que fecha o historico, nao a `_run_validation`."""
        mocker.patch("app.routes.schedules.DATABASE_URL", "postgres://test")
        from app.routes import certifications

        mocker.patch.object(certifications, "cleanup_old_validations", lambda: None)

        calls, cur = _recording_db(mocker)
        cur.fetchone.return_value = {"id": "sched-1", "brand_filter": None}

        started: dict = {}

        class _FakeThread:
            def __init__(self, target=None, args=(), daemon=False):
                started["target"] = target
                started["args"] = args

            def start(self):
                started["started"] = True

        mocker.patch("app.routes.schedules.threading.Thread", _FakeThread)

        resp = await test_client.post("/api/schedules/sched-1/run", headers=api_key_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"
        assert started["started"] is True
        assert started["target"] is schedules_module._run_manual_schedule
        # o worker recebe (schedule_id, run_id, brand, history_id)
        assert len(started["args"]) == 4
        assert started["args"][0] == "sched-1"
        # historico aberto ANTES da thread comecar
        assert _sql_matching(calls, "INSERT INTO cert_schedule_history")


# ---------------------------------------------------------------------------
# ALTO 5 — next_run nao pode congelar no passado
# ---------------------------------------------------------------------------


class TestNextRunRefresh:
    def test_execute_schedule_regrava_next_run(self, mocker):
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)

        job = mocker.MagicMock()
        job.trigger = build_cron_trigger("0 6 * * 1")
        mocker.patch.object(schedules_module.scheduler, "get_job", return_value=job)

        schedules_module._execute_schedule("sched-1", None)

        updates = _sql_matching(calls, "UPDATE cert_schedules SET next_run")
        assert len(updates) == 1
        next_run = updates[0][1][0]
        assert next_run > datetime.now(SAO_PAULO)
        assert next_run.astimezone(SAO_PAULO).weekday() == MONDAY

    def test_sem_job_registrado_nao_quebra_o_run(self, mocker):
        calls, _ = _recording_db(mocker)
        from app.routes import certifications

        mocker.patch.object(certifications, "_run_validation", lambda *a, **k: None)
        mocker.patch.object(schedules_module.scheduler, "get_job", return_value=None)

        schedules_module._execute_schedule("sched-1", None)

        assert not _sql_matching(calls, "UPDATE cert_schedules SET next_run")
        assert _sql_matching(calls, "UPDATE cert_schedule_history SET status")


# ---------------------------------------------------------------------------
# ALTO 6 — filtro de periodo nao pode esconder agendamentos nunca executados
# ---------------------------------------------------------------------------


class TestListSchedulesPeriodFilter:
    @pytest.mark.asyncio
    async def test_filtro_inclui_agendamentos_nunca_executados(
        self, test_client, api_key_headers, mocker
    ):
        mocker.patch("app.routes.schedules.DATABASE_URL", "postgres://test")
        calls, _ = _recording_db(mocker)

        resp = await test_client.get(
            "/api/schedules?start_date=2026-08-01&end_date=2026-08-31", headers=api_key_headers
        )
        assert resp.status_code == 200

        selects = _sql_matching(calls, "SELECT * FROM cert_schedules")
        assert len(selects) == 1
        sql = selects[0][0]
        assert "(last_run >= %s::date OR last_run IS NULL)" in sql
        assert "(last_run < (%s::date + interval '1 day') OR last_run IS NULL)" in sql

    @pytest.mark.asyncio
    async def test_sem_filtro_nao_gera_where(self, test_client, api_key_headers, mocker):
        mocker.patch("app.routes.schedules.DATABASE_URL", "postgres://test")
        calls, _ = _recording_db(mocker)

        resp = await test_client.get("/api/schedules", headers=api_key_headers)
        assert resp.status_code == 200
        assert "WHERE" not in _sql_matching(calls, "SELECT * FROM cert_schedules")[0][0]

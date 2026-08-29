"""Traducao do campo dia-da-semana entre a convencao crontab e a do APScheduler.

O painel de agendamentos fala CRONTAB: `0 6 * * 1` significa "toda SEGUNDA as
06:00" e a tabela de nomes do frontend le `0 = domingo`. O APScheduler 3.x usa
outra convencao no `day_of_week` NUMERICO — `0 = segunda` (a propria doc chama
isso de "historical mistake") — e `CronTrigger.from_crontab()` NAO converte: ele
reaproveita o mesmo parser numerico. Entregar o campo cru ao `CronTrigger`
deslocava TODO agendamento semanal em um dia (o preset "Semanal (Segunda)"
disparava na terca; "Semanal (Sexta)", no sabado).

Este modulo e o unico lugar que faz a conversao, e tanto a validacao
(`normalize_cron_expression`) quanto a montagem do job usam a mesma funcao, para
que "aceito na criacao" e "disparado no dia certo" nunca divirjam.
"""

from apscheduler.triggers.cron import CronTrigger

__all__ = ["build_cron_trigger", "crontab_dow_to_apscheduler"]

# crontab: 0 e 7 = domingo, 1 = segunda ... 6 = sabado
# apscheduler 3.x: 0 = segunda ... 6 = domingo   => (n + 6) % 7, com 7 tratado como 0
_CRONTAB_DOW_TO_APSCHEDULER = {n: (n + 6) % 7 for n in range(7)} | {7: 6}


def _expand_dow_token(token: str) -> set[int] | None:
    """Expande um token do campo dia-da-semana nos numeros crontab que ele denota.

    Aceita `*`, valor unico (`1`), intervalo (`1-5`, inclusive os que dao a volta
    como `5-2`) e passo (`*/2`, `1-5/2`). Devolve None quando o token nao e
    numerico — nomes (`mon`, `fri`) ja significam o MESMO dia nas duas
    convencoes, entao esses seguem intactos para o APScheduler.
    """
    base, sep, step_raw = token.partition("/")
    step = 1
    if sep:
        if not step_raw.isdigit() or int(step_raw) < 1:
            return None
        step = int(step_raw)

    base = base.strip()
    if base == "*":
        lo, hi = 0, 6
    elif "-" in base:
        lo_raw, _, hi_raw = base.partition("-")
        if not (lo_raw.isdigit() and hi_raw.isdigit()):
            return None
        lo, hi = int(lo_raw), int(hi_raw)
    elif base.isdigit():
        lo = hi = int(base)
    else:
        return None

    if not (0 <= lo <= 7 and 0 <= hi <= 7):
        return None

    # Intervalo que da a volta na semana (`5-2` = sex,sab,dom,seg,ter) — o
    # APScheduler rejeita inicio > fim, entao expandimos aqui.
    values = list(range(lo, hi + 1)) if lo <= hi else list(range(lo, 8)) + list(range(hi + 1))
    return set(values[::step])


def crontab_dow_to_apscheduler(field: str) -> str:
    """Converte o campo dia-da-semana de crontab (0=domingo) para APScheduler (0=segunda).

    Preserva `*`, listas (`1,3,5`), intervalos (`1-5`) e passos (`*/2`); `7` e
    tratado como domingo, igual a `0`. Campos com nomes de dia ou sintaxe que
    este parser nao reconhece passam intactos — nomes ja sao equivalentes nas
    duas convencoes e o proprio APScheduler valida o resto.

    Args:
        field: quinto campo da expressao crontab.

    Returns:
        O campo equivalente na convencao do APScheduler.
    """
    field = (field or "").strip()
    if not field or field == "*":
        return field or "*"

    crontab_values: set[int] = set()
    for token in field.split(","):
        token = token.strip()
        if not token:
            return field
        expanded = _expand_dow_token(token)
        if expanded is None:
            return field
        crontab_values |= expanded

    if not crontab_values:
        return field
    return ",".join(str(v) for v in sorted({_CRONTAB_DOW_TO_APSCHEDULER[n] for n in crontab_values}))


def build_cron_trigger(cron_expression: str, timezone: str = "America/Sao_Paulo") -> CronTrigger:
    """Monta um CronTrigger a partir de uma expressao crontab de 5 campos.

    Args:
        cron_expression: expressao crontab ja normalizada (5 campos separados por espaco).
        timezone: fuso do disparo.

    Returns:
        CronTrigger que dispara nos dias que a expressao crontab promete.

    Raises:
        ValueError: expressao com numero de campos errado ou valores invalidos.
    """
    parts = cron_expression.split()
    if len(parts) != 5:
        raise ValueError("Expressao cron deve ter 5 campos")
    return CronTrigger(
        minute=parts[0],
        hour=parts[1],
        day=parts[2],
        month=parts[3],
        day_of_week=crontab_dow_to_apscheduler(parts[4]),
        timezone=timezone,
    )

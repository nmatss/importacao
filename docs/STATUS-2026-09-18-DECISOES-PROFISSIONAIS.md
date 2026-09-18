# Decisões profissionais — 18/09/2026

Produção medida: `939714a`. Aplicação: `963f807`. Cultura Builder: revisão de
código, OWASP, design de interfaces. Planilhas-fonte e Linx write não alterados.

## O que o código fecha agora

| Decisão | Ação |
| --- | --- |
| Login sem allowlist | Fail-closed. Produção recusa subir sem `ALLOWED_DOMAIN`. |
| Webhook do Chat | Só `https://chat.googleapis.com`. Settings recusa outro host. |
| JWT localStorage | Mantido (ADR 0003). Dívida aceita enquanto o app for interno. |
| HSTS 300s | Mantido. CA interna e rollback. |
| Linx write | Permanece `false`. Sem homologação de FIM_VENDAS. |
| Follow-up cron | Permanece `dry_run`. Pilotos PK219/PK220/IM076 já aplicados. |
| Piso BL 90% | Mantido. PK219 89,670% continua pendente. Extração Vertex não persistida. |
| Versões de documento | Picker só inspeciona. Sem escolha canônica persistida. |
| Item PK220 | `27.01.0007` vs `27.01.2007-228` permanece para Odett/Eduarda. Evento 2906. |
| 5 SKUs de certificação | Pendência de fonte preservada. Sem overwrite da planilha. |
| UX leftover / cert-sync sujo | Fora deste corte. |

ADR: [0007](adr/0007-fail-closed-auth-and-chat-webhook.md).

## Holds que testes não fecham

- ALTO — BL PK219 abaixo de 90%
- ALTO — FIM_VENDAS no ERP
- ALTO — fontes concorrentes no comparativo/Registro
- MEDIO — divergência de item PK220
- MEDIO — PI4368Y, PI6014Y, 100400422, 100400423, 050403623 e 133 SKUs sem validade na origem
- BAIXO — expandir Follow-up além dos três pilotos

## Gates já comprovados no SHA publicado

CI #309 + CodeQL #322 em `939714a`. Suíte local 13:56: vitest 2548/9 skip, cert 1228/6 skip, typecheck/lint/prettier/ruff/build. Produção 13:53: health 200, LINX_WRITE false, hourly 947/5/674.

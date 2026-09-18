# ADR 0007 — Fail-closed no login e allowlist do webhook do Chat

**Data**: 2026-09-18
**Status**: Aceito

## Contexto

A validação do aceite em 18/09/2026 confirmou produção saudável em `939714a`,
com `ALLOWED_DOMAIN` preenchido e Linx write desligado. A revisão OWASP (Cultura
Builder) apontou dois modos de falha de configuração:

- `ALLOWED_DOMAIN` vazio admitia qualquer conta Google (`evaluateCorporateAccount`
  retornava `allowed: true`).
- O webhook do Google Chat só exigia `https:`, então um admin (ou valor
  comprometido no banco) podia apontar o `fetch` do servidor para um host
  interno.

Itens operacionais do aceite (BL PK219, FIM_VENDAS, versões concorrentes, item
PK220, SKUs ambíguos) permanecem decisão humana e não se resolvem no código.

## Decisão

1. Allowlist vazia **recusa** o login. Em `NODE_ENV=production`, a API **não
   sobe** sem `ALLOWED_DOMAIN`, no mesmo espírito de `CORS_ORIGIN`.
2. Webhook do Chat só é utilizável em `https://chat.googleapis.com`. A rota
   genérica de settings recusa outro host antes de gravar. URL vazia continua
   válida para desligar o canal.
3. JWT em `localStorage` permanece (ADR 0003). Não migrar para cookie httpOnly
   neste corte: app interno, CSP e DOMPurify já mitigam XSS; a troca é
   arquitetura nova.
4. HSTS `max-age=300` permanece: CA interna e rollback delimitado.
5. `LINX_WRITE_ENABLED=false` e Follow-up cron em `dry_run` permanecem até
   homologação explícita. Não baixar o piso de 90% do BL. Não substituir códigos
   de item nem escolher versão canônica de documento automaticamente.
6. Branches `feat/ux-ui-revisao-2026-09-18` e a árvore suja
   `fix/cert-sync-quarentena-2026-09-18` ficam de fora deste corte.

## Consequências

**Positivo**: tenant fechado se o SOPS perder a allowlist; SSRF do Chat reduzido
a um host oficial.

**Negativo**: ambiente local sem `.env` deixa de aceitar login Google. O
`.env.example` já lista os três domínios.

**Hold humano**: Odett/Eduarda (PK220 e versões), certificação (5 SKUs),
Elisangela/negócio (FIM_VENDAS), operação (BL PK219 e expansão do Follow-up).

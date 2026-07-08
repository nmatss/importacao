# Status 2026-07-08 - Relatorio SYDLE, Feedback Odett

## Objetivo Identificado

Responder aos apontamentos operacionais da Odett sobre o relatorio
`Compras e Pagamentos Internacionais` da SYDLE e manter a tela/exportacao em
padrao profissional para uso financeiro.

## Diagnostico

- A tela ja consumia dados reais da API SYDLE a cada 10 minutos e ja estava
  liberada para usuarios autenticados do modulo de importacao.
- A visao unificada ainda exibia campos tecnicos de conciliacao (`Match Portal`
  e `Motivo Match`) e colunas duplicadas de staging (`Código do processo` e
  `Compra`).
- Os cards financeiros usavam valor compacto, o que dificultava leitura
  financeira direta.
- CSV/PDF exportavam parte dos valores em formato bruto; XLSX precisava de
  celulas nativas de data/moeda para permitir filtro, soma e auditoria no Excel.
- Dados financeiros sensiveis da SYDLE (banco, contrato, remessa, cambio e BRL)
  continuam pendentes de permissao nas classes financeiras da SYDLE.

## Alteracoes Implementadas

- Cards financeiros do topo passam a exibir valores completos, sem abreviacao
  em "mil".
- Datas da tela SYDLE usam `dd/mm/aaaa hh:mm`.
- CSV/PDF exportam datas, valores e status ja formatados para leitura.
- XLSX exporta datas/moedas como celulas nativas, preservando uso de filtros,
  somatorios e auditoria no Excel.
- A visao/exportacao unificada remove as colunas `Código do processo` e
  `Compra`.
- `Match Portal` e `Motivo Match` foram renomeados para `Conciliação Portal` e
  `Evidência conciliação`.
- Motivos tecnicos como `process_code`, `brand,invoice` e
  `no_confident_match` aparecem em linguagem de negocio:
  `Processo`, `Marca + Invoice` e `Sem evidência suficiente`.
- O JSON da API continua preservando `processCode`, `purchaseRef`,
  `matchStatus` e `matchReason` para auditoria e integracoes.

## Dados E API

- Fonte de dados: API real da SYDLE One, classe
  `68bf1179b042c72f03993928` (`Solicitacao de Pagamento Internacional/current`).
- Scheduler: `sydle-sync` a cada 10 minutos.
- Full resync anterior de producao confirmou paridade com o CSV de referencia:
  26 registros e colunas SYDLE preservadas conforme disponibilidade da API.
- Campos financeiros de classe restrita nao sao estimados pelo portal. Entram no
  relatorio somente quando a propria SYDLE liberar/fornecer esses valores.

## Seguranca

- Leitura e exportacao do relatorio seguem liberadas para usuarios autenticados
  com acesso ao modulo de importacao.
- Sync manual, configuracao, historico de sync e payload bruto permanecem
  restritos a admin.
- `raw_payload` segue sanitizado antes de persistir chaves sensiveis comuns.
- Deploy em producao foi executado com `ALLOW_SYDLE_SYNC_DEPLOY=1`, conforme
  guard rail do `scripts/deploy.sh` para ambientes com `SYDLE_SYNC_ENABLED=true`.

## Testes E Validacao

Executados antes do deploy:

- `npm run typecheck` -> passed.
- `npm run lint` -> passed.
- `npm test` -> API 764 passed / 1 skipped; Web 114 passed.
- `npm run build` -> passed.
- Testes focados:
  - `npm test -w apps/api -- src/modules/sydle/__tests__/service.test.ts --run`
    -> 14 passed.
  - `npm test -w apps/web -- src/features/sydle-payments/SydlePaymentsPage.test.tsx --run`
    -> 9 passed.

Executado apos o deploy:

- `npm test` -> API 764 passed / 1 skipped; Web 114 passed.

## Deploy

- Commit implantado: `716725d fix(sydle): ajusta formatacao do relatorio`.
- SHA em producao: `716725d285fd`.
- Servidor: `192.168.168.124`.
- Deploy concluido em `2026-07-08 18:34:37 -0300`.
- Backup pre-deploy: `/home/nicolas/backups/importacao/importacao_2026-07-08_213156*`.
- Health checks:
  - API readiness: OK.
  - cert-api readiness: OK.
  - Web health: OK.
  - Public web health: OK.
- Containers pos-deploy:
  - `importacao-web`: healthy.
  - `importacao-api`: healthy.
  - `importacao-cert-api`: healthy.
  - `importacao-postgres`: healthy.
  - `importacao-redis`: healthy.

## Mensagem Enviavel Para Odett

Odett, ajustamos os pontos levantados no relatório da SYDLE e já publicamos em
produção. As datas e valores foram padronizados, os cards agora mostram os
valores completos, removemos as colunas duplicadas D/E da visão unificada e
trocamos “Match Portal”/“Motivo Match” por “Conciliação Portal”/“Evidência
conciliação”, com textos mais claros em português. A exportação continua
funcionando em CSV, Excel e PDF; no Excel, datas e moedas agora ficam em formato
próprio para filtro e soma. Sobre banco, contrato, remessa, câmbio e BRL,
mantivemos a regra de não estimar pelo portal: esses campos entrarão
automaticamente assim que a SYDLE liberar o acesso às classes financeiras.

## Pendencias

- Aguardar liberacao da SYDLE para leitura das classes financeiras que contem
  banco, contrato de cambio, remessa, cambio e valores BRL.
- Quando a permissao for liberada, executar sync/full resync administrativo se
  houver mudanca de mapeamento ou necessidade de reprocessar historico.

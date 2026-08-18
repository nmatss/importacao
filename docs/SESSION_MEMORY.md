# Session Memory

## 2026-08-14 - Incidente De Egress Da API E Login Google

Objetivo:

- Atender o relato de Franciely Mafra ("nao estou conseguindo acessar o
  sistema", 13/08 17:16 BRT e 14/08 08:01 BRT) e descobrir por que a tela dela
  mostrava "Sua sessao expirou" em loop.

Resultado:

- Nao era cadastro dela. Franciely (`users.id=6`, `analyst`, ativa) nunca gerou
  `login_failed` com `not_in_group`: as 8 tentativas dela morreram em excecao de
  rede, com `Google Groups: error checking membership` /
  `ETIMEDOUT https://oauth2.googleapis.com/token`. Odett e Leticia bateram no
  mesmo erro.
- O `importacao-api` estava sem rota de saida para a internet. Alcancava banco,
  Redis, gateway do bridge, host e roteador da LAN em menos de 1 ms e mantinha
  `/health/ready` verde, mas nada saia para fora.
- A rota default do container caia em `ia-local-net` (192.168.208.1). Um alpine
  descartavel no mesmo bridge saiu 12/12 enquanto a API falhou 0/12. Descartados
  por teste: veth velho, subnet sobreposta, conntrack cheio, MTU, DNS e a
  propria rede.
- Gatilho: reboot do host em 01/08 as 17:38 UTC. A primeira falha do
  `sydle-sync` veio as 17:40, e foram 1.864 falhas consecutivas com zero
  sucessos ate 14/08 16:20 — 12 dias e 22 horas.
- O mesmo incidente ja tinha sido diagnosticado corretamente em
  `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`, com o plano de correcao escrito
  (incluindo `gw_priority`). Nada foi aplicado na epoca.
- Correcao de rede aplicada ao vivo (`--gw-priority -100`) e depois no compose.
  Primeiro sync bem-sucedido em 12d22h as 16:20; Franciely logou as 16:55:52.
- Correcao de codigo: `isNetworkError`, `ServiceUnavailableError` (503) e
  `ForbiddenError` (403), controller respeitando `statusCode`, `api-client` sem
  sequestrar 401 dos endpoints de login e cache/sobrevida da checagem de grupo.
  16 testes novos; 877 API + 127 web passando.
- Deploy do SHA `0b5393e` em 14/08 13:31-13:34 BRT, 8/8 etapas OK. O container
  recriado recebeu de novo o IP `192.168.208.4` e mesmo assim manteve saida —
  prova de que sem `gw_priority` o deploy teria reintroduzido a falha.

Pendencias:

- A regra que bloqueia especificamente o `192.168.208.4` continua desconhecida
  (`sudo` no servidor pede senha). O `gw_priority` contorna, nao remove.
- Nao existe alerta de egress nem de cron falhando em sequencia; o detector do
  incidente foi a usuaria.
- Uma falha isolada do sync as 18:20 UTC em observacao.

Evidencia canonica:

- `docs/INCIDENTE-2026-08-14-EGRESS-API.md`

## 2026-08-03 - Planejamento Do Reprocessamento Integral Sem O DEMO

Objetivo:

- Analisar o reprocessamento de 100% da base documental operacional, excluindo
  o atendimento/processo de demonstracao.

Resultado:

- DEMO identificado como processo `264`, codigo
  `DEMO-IM0712602NB-E227210`, com 11 documentos e 27 atendimentos vinculados.
- A exclusao deve usar `process_id <> 264`, nao texto livre.
- Fora do DEMO existem 121 documentos em 25 processos; todos os 121 arquivos
  locais existem, 99 documentos estao processados e 22 pendentes.
- Existem 28 grupos duplicados de `processo + tipo`, com 73 versoes excedentes.
  O lote deve selecionar somente o documento canonico mais recente de cada
  `processo + tipo`.
- Antes de triagem existem 40 documentos canonicos tipados. O classificador
  atual sugeriu reclassificar 11 dos 26 `other`: 6 proformas, 4 invoices e 1
  Draft DUIMP. Quinze continuam inconclusivos.
- A simulacao das reclassificacoes produziu 44 canonicos. Dois sao espelhos PDF
  incompativeis com o parser atual; o lote executavel fica em 42 documentos
  (39 via IA e 3 espelhos XLSX), distribuido por 21 processos.
- Os 21 processos incluem 11 `draft`, 6 `validating`, 3 `validated` e 1
  `completed`; este ultimo nao aceita transicao para `validating`.
- Fila pg-boss vazia, zero leases ativas, zero documentos travados, zero
  aceites de comparativo ativos e espaco/custo suficientes.
- Vertex, Drive, Chat e OCR estao ativos. A rota existente pode criar arquivos
  duplicados no Drive, relatorios, movimentos de pasta, validacoes repetidas e
  alertas externos; por isso o disparo bruto foi classificado como NO-GO.
- Producao usa lease de 10 minutos, abaixo dos 20 minutos do timeout de texto e
  dos 25 minutos do job. Ajustar para 25 minutos antes do lote.
- O backup mais recente encontrado era de 2026-07-17; novo backup de banco e
  `uploads` e obrigatorio.
- Health retorna `revision: null`/`APP_VERSION=dev`, apesar de os fontes
  criticos do servidor coincidirem com o workspace.
- Custo projetado das 39 chamadas canonicas e inferior a US$ 1 com base no
  historico recente, mas a estimativa tem confianca medio-baixa.

Decisao:

- Nao executar o lote pelas rotas unitarias atuais.
- Implementar executor admin-only com dry-run, batch ID, retomada, selecao
  canonica, exclusao obrigatoria do processo 264 e modo de manutencao para
  diferir Drive, Chat e validacao.
- Higienizar os 15 `other` e os 2 espelhos PDF, criar backup, rodar piloto e so
  depois executar um processo por vez.

Testes:

- Testes focados de historico/reprocessamento, service documental e
  classificacao: 3 arquivos, 42 testes aprovados, 0 falhas.

Alteracoes:

- Somente documentacao e memoria. Nenhuma escrita em producao e nenhum
  reprocessamento executado.

Fonte canonica:

- `docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md`

## 2026-08-03 - Incidente de Login Google e Egress Docker

Resultado:

- Confirmado o relato de Leticia: ela, Eduarda (associacao inferida com
  confianca alta para "Duda") e Odett tiveram nove tentativas de login
  bloqueadas entre 09:16 e 09:19 BRT.
- Os tres cadastros existem como `analyst`, estao ativos e nao houve evidencia
  de ausencia no Google Group ou credencial invalida.
- Logs da API mostraram `ETIMEDOUT` em `oauth2.googleapis.com/token` durante o
  gate obrigatorio do Google Group; o controller converteu a falha externa em
  HTTP 401.
- A API usa `importacao_default` e `ia-local-net`, mas o default gateway estava
  em `ia-local-net`. Probe pela origem `192.168.208.4` expirou; o mesmo probe
  pela origem `172.20.0.9` de `importacao_default` respondeu em 221 ms.
- Host de producao e `cert-api` acessaram o Google normalmente, isolando a
  falha na rota/NAT do container da API.
- Houve login bem-sucedido das tres as 11:37 BRT, mas nova verificacao posterior
  falhou; incidente permanece aberto/intermitente.
- API/web/cert-api, raiz publica e `/api/health` estavam verdes, demonstrando
  lacuna de observabilidade para Auth/egress externo.
- Nenhuma mudanca de producao, banco, permissao ou codigo foi aplicada.

Fonte canonica, riscos e plano de correcao:

- `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`
- `docs/KNOWN_ISSUES.md`

## 2026-07-10 - Auditoria Profunda de Análise Documental

- Revisado o pipeline upload/e-mail → magic bytes → fila de extração → parser/
  IA → harness de confiança → linhagem/projeção → comparativo/validação.
- Corrigida lacuna de recuperação: operador pode reclassificar documento já
  ingerido, preservando extração anterior, invalidando derivados e reenfileirando
  o parser correto.
- Origem de documento agora prioriza `email_attachment_documents` por
  `document_id`; o fallback por nome/últimos logs ficou apenas para legado.
- Riscos registrados em `docs/STATUS-2026-07-10-DOCUMENT-ANALYSIS.md`: OCR,
  exclusão mútua de worker, corpus ouro/eval em CI, evidência por página e
  limites de payload multimodal.

## 2026-07-10 - Revisão de fechamento do feedback Odett

Resultado:

- Comunicação com status `failed` voltou a ser recuperável: editar reabre o
  rascunho, limpa o erro e mantém a auditoria para correção e novo envio.
- Follow-Up expõe as 15 etapas persistidas e calcula progresso por proporção,
  corrigindo o teto incorreto de 90% com todas as etapas concluídas.
- Registro/DUIMP, Etapas, Erros/Custos e Follow-Up distinguem falha de API de
  estado vazio e oferecem retry.
- A Visão unificada SYDLE ganhou o badge PI/INV ao usar o fallback de Processo.

Pendências operacionais confirmadas:

- Follow-Up para planilha não possui job automático; só há comparação/sync
  administrativo por processo. A ativação requer planilha-fonte, periodicidade
  e regra explícita de conflito para evitar sobrescrita de dados operacionais.
- A produção estava configurada com mailbox de ingestão diferente da caixa
  global solicitada; alinhar `GMAIL_SHARED_MAILBOX=global@grupounico.com` no
  próximo rollout aprovado.
- O reprocessamento do processo real PK2052602TJ continua dependente dos
  documentos reais/anonimizados e não foi declarado validado sem essa evidência.

## 2026-07-09 - Feedback Odett: Atendimentos, Comparativo, DUIMP e SYDLE

Resultado:

- Menu Atendimentos ganhou seleção pesquisável/editável de processo, anexos de
  documentos do processo e edição/envio de rascunhos existentes.
- Aba Atendimentos dentro do processo passou a expandir rascunhos/enviados,
  editar destinatário, assunto, corpo e anexos, salvar e enviar após validação.
- Ingestão de e-mails passa a armazenar corpo textual novo em
  `email_ingestion_logs.body_text`; aba E-mails permite expandir e consultar o
  corpo quando disponível.
- Envio de comunicações ganhou cópia fixa configurável por
  `COMMUNICATION_DEFAULT_CC`/`default_cc_email`.
- Processo ganhou observação urgente vermelha em faixa fixa no topo.
- Documentos agora aceitam/classificam `draft_duimp` e `duimp`; processo ganhou
  campos, UI e conferencia automatica de Registro Aduaneiro contra Draft
  DUIMP/DUIMP quando a extracao trouxer os campos.
- Comparativo removeu o checklist grande da aba, ocultou checks gerais que a
  operação pediu para mover/remover, melhorou matching de itens com código
  canônico e corrigiu NCM para OHBL x Espelho.
- Comparativo geral ficou editavel por coluna com auditoria, evento do processo
  e mensagem `Editado por`.
- Modelos de atendimento passaram a ser gerenciaveis em Configuracoes > Modelos
  por usuarios autenticados, e reutilizados no menu Atendimentos e na aba do
  processo.
- Processo ganhou abas `Etapas` e `Erros/Custos`, com APIs auditadas para etapas
  especificas, erros documentais e custos extras.
- Comparativo de itens passou a exibir fabricante e proporcao peso
  bruto/liquido por item; quadro dedicado de fabricantes compara INV, PL e
  Espelho. A extracao de Invoice agora aceita `manufacturerAliases` para
  conferencia de rodape x Espelho quando o documento trouxer essa lista.
- Gmail usa `global@grupounico.com` como mailbox compartilhado padrao quando
  `GMAIL_SHARED_MAILBOX` nao estiver explicitamente configurado.
- Relatório SYDLE passou a usar `Número Invoice` como fallback da coluna
  Processo quando não há processo e exibe badge `PI`/`INV`.
- SYDLE One deixou de derivar `paidAt`/status/valores pagos da finalização do
  ticket; a regra agora usa a parcela (`paymentData`) e evita marcar parcelas
  abertas como pagas ou vencidas incorretamente.

Residual registrado em `docs/ROADMAP.md` e no status da entrega:

- Refinos especificos do processo real `PK2052602TJ` com fixtures reais
  anonimizadas.
- Base mestre de fornecedores/fabricantes e regra final de aliases no rodape da
  Invoice, se a conferencia por aliases extraidos nao for suficiente.
- Validacao DUIMP pode precisar de novos aliases depois de testar documentos
  reais anonimizados.

Testes:

- `npm run typecheck` -> passed.
- `npm test -w apps/api -- sydle validation documents` -> 31 files / 282 tests passed.
- `npm test -w apps/web -- SydlePaymentsPage DocumentComparison DocumentList DocumentUpload` -> 4 files / 25 tests passed.
- `npm run lint` -> passed.
- `npm test` -> API 765 passed / 1 skipped; Web 115 passed.
- `npm test -w apps/api -- sydle` -> 4 files / 49 tests passed apos ajuste
  final de status.
- `npm run build` -> passed.
- `git diff --check` -> passed.

## 2026-07-08 - Documentacao Pos-Deploy SYDLE Feedback Odett

Resultado:

- Criado `docs/STATUS-2026-07-08-SYDLE-FEEDBACK.md` como trilha auditavel da
  entrega do feedback Odett no relatorio `Compras e Pagamentos Internacionais`.
- Registro consolida objetivo, diagnostico, alteracoes, impacto em dados/API,
  seguranca, testes, deploy, backup pre-deploy, health checks e mensagem
  enviavel para Odett.
- Commit implantado em producao: `716725d fix(sydle): ajusta formatacao do relatorio`.
- SHA de deploy: `716725d285fd`.
- Backup pre-deploy registrado:
  `/home/nicolas/backups/importacao/importacao_2026-07-08_213156*`.
- Health de API, cert-api, web e health publico passaram no deploy.
- Repositorio local ficou limpo apos deploy e validacao pos-deploy.

## 2026-07-08 - Feedback Odett Relatorio SYDLE

Resultado:

- Ajustada a visão unificada SYDLE para remover as colunas duplicadas `Código do processo` e
  `Compra`, preservando esses campos no JSON da API para auditoria e
  integrações.
- `Match Portal`/`Motivo Match` foram substituídos por `Conciliação Portal` e
  `Evidência conciliação`; motivos técnicos como `process_code`,
  `brand,invoice` e `no_confident_match` passam a aparecer em português na tela
  e nas exportações.
- Cards financeiros do topo passam a exibir valores completos em USD, sem
  abreviação em "mil".
- Datas da tela SYDLE usam padrão `dd/mm/aaaa hh:mm`; CSV/PDF exportam datas,
  valores e status já formatados; XLSX usa células nativas de data/moeda.
- Campos financeiros de classe SYDLE ainda pendentes permanecem sem estimativa
  do portal: banco, contrato, remessa, câmbio e BRL só aparecem quando a própria
  SYDLE liberar/fornecer os dados.

## 2026-07-08 - Paridade Do Relatorio SYDLE Analytics/CSV

Resultado:

- Analisado o CSV local `Relatório Sydle.csv` como fonte complementar do
  staging SYDLE: 26 linhas e 16 colunas, com protocolo, invoice, beneficiário,
  marca, tipo, vencimento, moeda, valor, datas operacionais, exceção, processo,
  embarque, prazo pós-embarque e última alteração.
- Adicionada migration idempotente `0021_sydle_report_columns.sql` para
  preservar essas colunas em `sydle_purchase_payments`.
- Normalizador SYDLE passou a reconhecer aliases do CSV, tratar `(vazio)` como
  nulo e derivar chave por protocolo + invoice + vencimento + valor + prazo
  pós-embarque quando a fonte não fornece ID único de parcela.
- Listagem, detalhe e exportações SYDLE passam a devolver/exportar as colunas
  novas; drawer web exibe os campos complementares no detalhe.
- Scheduler SYDLE alterado de `*/15 * * * *` para `*/10 * * * *`; frontend
  também atualiza/refaz consulta a cada 10 minutos.
- Tela SYDLE ganhou visão unificada abaixo da visão operacional, com colunas na
  mesma ordem do Excel/CSV.
- Relatório SYDLE deixou de preencher câmbio/BRL com estimativas do portal
  (`currency_exchanges`); cards, tabelas, detalhe e visão unificada exibem
  valores financeiros apenas quando a SYDLE fornece esses campos.
- Revisao pos-deploy identificou que as colunas novas ficavam vazias nos
  registros antigos porque o cron incremental consultava somente itens alterados
  desde o cursor de 2026-07-07. Corrigido com `POST /api/sydle/sync-now?full=1`
  para full resync auditavel e aliases reais do payload SYDLE One:
  `requestData.emissionDate`, `requestData.endDateForm` e
  `requestData.departureDate`.
- Tipo de pagamento foi alinhado ao CSV/API: `requestData.paymentType`
  `depositInAdvance`, `beforeShipment` e `afterShipment` agora aparecem como
  `Deposit in Advance`, `Balance before Shipment` e `Balance after Shipment`.
- Ajustado controle de acesso do modulo SYDLE: leitura, exportacao, menu lateral
  e atalho do portal ficam disponiveis para todos os usuarios autenticados com
  acesso ao modulo de importacao; sync manual, config, historico de sync e
  payload bruto permanecem admin-only.

Testes:

- `npm test -w apps/api -- src/modules/sydle/__tests__/normalizer.test.ts src/modules/sydle/__tests__/client.test.ts src/modules/sydle/__tests__/routes.test.ts --run` -> 31 passed.
- `npm test -w apps/api -- src/modules/sydle/__tests__/normalizer.test.ts src/modules/sydle/__tests__/client.test.ts src/modules/sydle/__tests__/service.test.ts src/modules/sydle/__tests__/routes.test.ts --run` -> 43 passed.
- `npm test -w apps/web -- src/features/sydle-payments/SydlePaymentsPage.test.tsx --run` -> 9 passed.
- `npm run lint` -> passed.
- `npm run build` -> passed.
- `npm run typecheck` -> passed.
- `npm test` -> API 759 passed / 1 skipped; Web 114 passed.

## 2026-06-29 - Feedback Odett/Eduarda: Espelho, Draft BL E Configuracoes

Resultado:

- Revisado o feedback operacional ponto a ponto contra documentos, comparativo, espelho, Draft BL,
  configuracoes/e-mail e pendencias registradas.
- Corrigido parser de espelho XLSX para aceitar aliases ingleses comuns de codigo/SKU e peso
  liquido/bruto (`Code`, `SKU`, `Net Weight`, `Gross Weight`, `N.W.`, `G.W.`, `GW/NW`).
- Aba Configuracoes agora expõe "E-mails" e mostra "Destinatarios operacionais" no topo, reduzindo
  a dificuldade relatada para liberar allowlist de envio.
- Draft BL ganhou aceite "Draft Recebido" no checklist e botao "Reprocessar" no documento atual.

Testes:

- `npm run typecheck` -> passed.
- `npm test -w apps/api -- src/modules/espelho-parser/__tests__/parser.test.ts src/modules/ai/utils/__tests__/packing-list-text-parser.test.ts` -> 24 passed.
- `npm test -w apps/web -- src/features/documents/DocumentComparison.test.tsx` -> 12 passed.
- `npm run lint` -> passed.
- `npm run build` -> passed.

## 2026-06-25 - Login Google De Analista Voltando Para Login

Resultado:

- Investigado caso `mariana.santos@grupounico.com`: usuaria em
  `importacao@grupounico.com` autenticava via Google, o portal abria e em
  seguida recarregava para `/login`.
- Causa raiz identificada no frontend/proxy: o portal executava
  `fetchCertStats()` e `checkCertApiHealth()` para todos os usuarios; a rota
  `/cert-api/` valida `GET /api/auth/cert-api-access`, que exige papel `admin`.
  Usuarios Google auto-criados entram como `analyst`. O nginx mapeava tanto
  `401` quanto `403` para `401`, e `certApiFetch()` apagava
  `localStorage.importacao_token` ao receber 401.
- Corrigido `PortalPage`: chamadas e links de Certificacoes ficam ativos apenas
  para `admin`; para `analyst`, o card exibe acesso restrito e nao toca na
  cert-api.
- Corrigidos `apps/web/nginx.conf` e `infra/nginx/prod.conf`: `401` e `403` da
  auth_request da cert-api agora sao preservados como respostas distintas.
- Adicionado teste de regressao `PortalPage.test.tsx` cobrindo que analistas nao
  disparam cert-api no portal e admins continuam disparando.

Testes:

- `npm --workspace apps/web test -- PortalPage.test.tsx` -> 2 passed.
- `npm --workspace apps/web run typecheck` -> passed.
- `npm --workspace apps/web run build` -> passed.
- `npm run lint` -> passed.
- `npm run typecheck` -> passed.
- `npm test` -> API 739 passed / 1 skipped; Web 108 passed.

## 2026-06-19 - SYDLE One Real E Publicacao Via Nginx Interno

Resultado:

- Topologia publica corrigida para o desenho real confirmado pelo usuario:
  Nginx/edge externo -> Nginx interno do container `web` em
  `192.168.168.124:8085`. O compose de producao manteve `8085:80` publicado e
  removeu tentativa de Traefik/rede externa do `web`.
- Deploy do SHA `0602241891addbee66d969b778c3a3f4aa1d19c3` em 2026-06-19
  passou health interno e publico: `https://importacao.grupounico.com/`
  retornou HTTP 200, e `/api/auth/me` via dominio publico retornou 401
  esperado sem token.
- A tela `/importacao/compras-pagamentos` ainda exibia sync ignorada porque a
  producao estava com `SYDLE_SYNC_ENABLED=false` e sem variaveis Sydle One.
- Projeto local `SydleOne` analisado. O padrao real e login em
  `/api/1/main/sys/auth/signIn`, cookie de sessao e `POST _classId/{id}/_search`.
- A classe real `68bf1179b042c72f03993928` (`Solicitacao de Pagamento
Internacional/current`) foi consultada com credenciais do cofre local sem
  expor segredos: retornou 14 solicitacoes, `paymentData[]`, ticket e moeda.
- Permissoes atuais permitem ler solicitacao principal, ticket, status e moeda;
  buscas diretas em `InternationalPaymentOpenForm` e `RequestData` retornaram
  403, entao fornecedor/PI/invoice dependem de permissao ou visao consolidada.
- API passou a suportar `SYDLE_SOURCE_TYPE=sydle_one_class`, login Sydle One,
  `_classId/_search` com `search_after`, lookup de ticket/status/moeda e
  achatamento de parcelas em linhas financeiras.
- Env/compose/docs/memoria atualizados para `SYDLE_APP`, `SYDLE_USER`,
  `SYDLE_PASSWORD`, `SYDLE_CLASS_ID`, `SYDLE_DATE_FIELD` e classes auxiliares.

Testes:

- `npm test -w apps/api -- src/modules/sydle/__tests__/client.test.ts src/modules/sydle/__tests__/normalizer.test.ts src/modules/sydle/__tests__/service.test.ts --run` -> 27 passed.
- `npm run typecheck -w apps/api` -> passed.
- `git diff --check` -> passed.
- `npm run lint` -> passed.
- `npm run typecheck` -> passed.
- `npm test -w apps/api -- src/modules/sydle/__tests__/client.test.ts src/modules/sydle/__tests__/normalizer.test.ts src/modules/sydle/__tests__/service.test.ts src/modules/sydle/__tests__/routes.test.ts --run` -> 31 passed.
- `npm run build` -> passed.
- `npm test` -> API 692 passed / 1 skipped; Web 95 passed.
- `bash -n scripts/deploy.sh` -> passed.

Deploy/validacao:

- Commit `5362dd3a343a955c4e694cde3df457c92b99c512`
  (`feat: enable sydle one payment sync`) enviado ao GitHub e implantado em
  `192.168.168.124` por `scripts/deploy.sh` com
  `ALLOW_SYDLE_SYNC_DEPLOY=1`.
- Backup pre-deploy validado em
  `/home/nicolas/backups/importacao/importacao_2026-06-19_225549*`.
- Deploy passou SOPS, compose config, migrations idempotentes, restart,
  API health, cert-api readiness, web health e public health.
- `https://importacao.grupounico.com/` retornou HTTP 200; chamada publica
  `/api/auth/me` retornou 401 esperado sem token.
- `.env` remoto contem `SYDLE_SOURCE_TYPE=sydle_one_class`,
  `SYDLE_SYNC_ENABLED=true` e variaveis Sydle One preenchidas via SOPS.
- Sync manual pos-deploy (`sydle_sync_runs.id=109`) finalizou `success`:
  `fetched=20`, `created=20`, `errors=0`, `sourceType=sydle_one_class`.
- Cron das 20:00 BRT (`sydle_sync_runs.id=110`) finalizou `success`:
  `fetched=2`, `updated=2`, `errors=0`; esse resultado e esperado pelo overlap
  de cursor de 5 minutos e nao duplicou linhas.
- Totais em `sydle_purchase_payments`: 20 linhas, USD 154.847,83 comprados,
  USD 57.142,08 pagos, USD 97.705,75 em aberto; 13 linhas `open` e 7 `paid`.
- Todas as 20 linhas ficaram `unmatched` porque a fonte acessivel traz ticket
  SYDLE (`SYDLE-...`) e valores, mas nao PI/invoice/processo/fornecedor por
  falta de permissao nos formularios complementares.

## 2026-06-19 - Go-live UAT Importacao, Certificacao E Estoque WMS

Objetivo:

- Corrigir feedback operacional de Importacao/Certificacao e revisar prontidao
  go-live com subagentes focados em importacao, certificacao, Proformas/Espelho,
  QA/release e relatorio WMS.

Resultado:

- Importacao: status logistico persistido passou a usar ETD/ETA/Data Embarque do
  espelho/BL; card do processo prioriza BL/Espelho para Data Embarque/Frete/
  Container; barra visual do ciclo nao deixa o default `consolidation` esconder
  ETD passado; coluna Sistema no comparativo casa por check key e eleva a linha
  para falha quando o Sistema diverge; Container numerico e Tipo Container foram
  separados; anomalias de itens passam a seguir a comparacao deterministica
  mesmo sem emissao da IA; download XLSX do Espelho usa `espelho.id`; edicao
  manual do Espelho envia `ncmCode`/`boxQuantity`.
- Extracao: Invoice/PL passaram a aceitar datas logisticas separadas; itens de
  Invoice aceitam peso liquido/bruto quando impresso.
- Certificacao: rota `/api/products?license_status=VENCIDO` ganhou cobertura com
  `license_map` da aba `Licenciamentos Vencidos`.
- Relatorio de estoque: export `Estoque Detalhado` preserva WMS ao filtrar por
  marca, normaliza `puket_escolares`, inclui `Sincronizado em`, retorna erro
  claro para `cert-reports` sem escrita, e a UI oculta acoes JSON/Ver para XLSX.
- Operacao: Dockerfiles API/Web usam contexto raiz + manifests dos workspaces +
  `npm ci --ignore-scripts` com `HUSKY=0`; compose prod adiciona
  `cert-volumes-init`; cert-api readiness valida escrita em `REPORTS_DIR`;
  deploy/rsync exclui `.claude` e `.codex`; API image expõe deps do workspace
  para `/app/dist`; web prod publica `8085:80` para o Nginx/edge externo;
  compose prod exige
  `CORS_ORIGIN`/`GOOGLE_GROUP_ALLOWED`, define `TRUST_PROXY=1` e repassa `LINX_*`
  ao cert-api.
- SYDLE: conciliacao por PI/invoice/pedido agora busca valores em
  `aiExtractedData` aninhado e em campos `{ value, confidence }`; sync usa lock
  transacional; fallback de `externalId` prioriza referencias de negocio
  estaveis e tipo de parcela, sem vencimento/fornecedor/marca; rotas API de
  relatorio/export/sync ganharam cobertura.
- SYDLE UI/operacao: relatorio admin-only disponivel em
  `/importacao/compras-pagamentos`, menu `Importacao > Operacional >
Compras/Pagamentos SYDLE` e atalho no portal para admins; tabela/mobile
  exibem cambio, BRL, banco, contrato, remessa, datas de pagamento/agendamento,
  motivo de conciliacao e filtros por atualizacao da fonte.
- Release: `scripts/deploy.sh` valida a rede externa `ia-local-net`, executa
  `cert-volumes-init` explicitamente antes do restart com `--no-deps`, e a
  imagem API remove `npm`/`npx` do runtime final. O deploy tambem bloqueia
  `SYDLE_SYNC_ENABLED=true` ate rollout financeiro aprovado com
  `ALLOW_SYDLE_SYNC_DEPLOY=1`.
- SOPS/deploy: primeira tentativa de deploy do SHA `49aea2a` abortou antes de
  migrations/restart porque o compose remoto detectou
  `GOOGLE_SHEETS_SPREADSHEET_ID` e `GRAFANA_ADMIN_PASSWORD` ausentes no SOPS.
  Containers existentes seguiram saudaveis. O SOPS remoto e versionado foi
  corrigido com o spreadsheet ID preservado do `cert-api` em execucao e uma nova
  senha forte de Grafana; `docker compose -f docker-compose.prod.yml config
--quiet` passou no servidor.
- TLS/publicacao: deploy do SHA `b4f4872` subiu containers saudaveis e passou
  health interno, mas o health publico retornou 502 porque o Traefik compartilhado
  roteava `importacao.grupounico.com` para um router generico de n8n. O compose
  de producao passou a conectar o `web` na rede externa `n8n_enterprise_web` e a
  declarar labels Traefik dedicadas para `importacao.grupounico.com`.
- Correcao da rota publica: o usuario confirmou que a topologia correta era
  Nginx/edge externo -> Nginx interno do container `web`, como antes. A causa
  provavel do 502 passou a ser o bind `127.0.0.1:8085`, que impede um proxy
  externo de acessar `192.168.168.124:8085`. O compose voltou a publicar
  `8085:80` e removeu labels/rede Traefik do `web`.
- Deploy operacional final: SHA `3f36137a697fee9f4f1011bc3eace3417467d5be`
  publicado em `192.168.168.124` por `scripts/deploy.sh` em 2026-06-19
  19:16 BRT. Backup validado em
  `/home/nicolas/backups/importacao/importacao_2026-06-19_221502*`, migrations
  idempotentes aplicadas, `REVISION` remoto gravado e containers
  `importacao-api`, `importacao-web`, `importacao-cert-api`, Prometheus,
  Grafana e Alertmanager iniciados.
- Health pos-deploy: API interna `http://127.0.0.1:3050/health/ready`
  retornou `status=ok` com DB/Redis OK; web interna
  `http://127.0.0.1:8085/` retornou 200; readiness da cert-api passou dentro
  do container em `/api/ready` com `ready=True`.
- Bloqueio publico remanescente: `https://importacao.grupounico.com/` ainda
  retorna `HTTP/2 502` com header `server: nginx`. O host local resolve o
  dominio para `10.106.185.28`; o Traefik do servidor responde ao Host em HTTP
  com 302, mas HTTPS direto por SNI falha com `tlsv1 unrecognized name` e
  `/letsencrypt/acme.json` nao contem certificado para o dominio. Logs ACME
  indicaram que a validacao publica chegou em `177.36.181.21` e recebeu 404 no
  challenge. Portanto o app esta implantado internamente, mas o go-live publico
  depende de DNS/proxy/certificado fora do compose da aplicacao.

Testes direcionados:

- API Vitest direcionado: 75 passed.
- Web Vitest direcionado: 22 passed + nova rodada Importacao 23 passed.
- Cert-api pytest direcionado: 25 passed.
- SYDLE Vitest direcionado: API 19 passed, Web 2 passed.
- SYDLE rodada final: 27 passed.

Validacao global:

- Gates completos executados: `git diff --check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`, E2E API, `pytest -q
apps/cert-api`, compileall Python, shell checks, compose prod config, npm
  audit HIGH, pip-audit, builds Docker sem cache API/Web/Cert-API, runtime API
  e Trivy HIGH/CRITICAL nas tres imagens.

Pendencias:

- Go-live publico bloqueado ate `curl -fS https://importacao.grupounico.com/`
  retornar 200 e uma chamada API via dominio publico funcionar. A topologia
  esperada e Nginx/edge externo terminando TLS e fazendo proxy para
  `192.168.168.124:8085`.
- SYDLE segue dependente de contrato/API/payload real, identificador estavel de
  pagamento, credenciais e UAT financeiro; para dados reais, e bloqueador
  externo critico.
- Definir SLA de frescor para `cert_stock` antes de tratar relatorio de estoque
  como 100% operacional.

## 2026-06-19 - Hardening De Validacao Documental E SYDLE

Escopo:

- Executar revisao enterprise com subagentes e aplicar correcoes prioritarias
  para impedir falso "100%" documental e elevar o relatorio SYDLE de
  pagamentos internacionais.

Correcoes aplicadas:

- `runAllChecks` passou a aceitar modo `partial` ou `final`.
- Validacao parcial automatica agora e diagnostica: nao promove processo para
  `validated`, nao move pasta de correcao, nao gera rascunho KIOM, nao atualiza
  follow-up final e nao sobrescreve resultados finais.
- Validacao final ganhou check sistemico `document-set-completeness`, bloqueando
  validacao quando Invoice, Packing List e OHBL/Draft BL utilizaveis nao estao
  presentes.
- `validation_runs` passou a ser registrado por execucao e vinculado a
  `validation_results`, `validation_result_history` e `document_corrections`
  via migration `0018_validation_run_links.sql`.
- Validacao final passou a persistir `validation_runs`, snapshots/live results
  e `document_corrections` atomicamente, evitando run orfao e perda de
  correcao em falha intermediaria.
- Historico de extracao passou a preservar `process_id`, tipo, nome original e
  `storage_path`; delete de documento arquiva a extracao antes de remover a
  linha e a FK passa a `ON DELETE SET NULL`.
- Historico de extracao passou a ser recuperavel por processo em
  `GET /api/documents/process/:processId/extraction-history`, cobrindo
  documentos ja excluidos.
- Falha de schema Zod da IA agora marca `_trust.contractFailure` e derruba a
  confianca abaixo de 40%, mantendo evidencia auditavel sem uso automatico.
- Checks `certificate-completeness` e `weight-ratio-check` deixaram de retornar
  `passed` sem evidencia documental minima.
- SYDLE passou a usar cursor por `sourceUpdatedAt`/`updatedAt` da fonte com
  overlap de 5 minutos, parser de data/hora PT-BR, matching conservador que nao
  concilia por invoice/PI/pedido isolado, exportacao CSV paginada completa,
  redaction de `raw_payload` e rotas/tela restritas a admin.
- Frontend passou a mostrar documentos de baixa confianca como "nao
  utilizaveis", checks `skipped` como bloqueados, erros de API como erro/retry
  sem apagar dados em cache, e datas SYDLE `YYYY-MM-DD` sem shift de timezone.
- Upload/marco operacional passou a considerar Invoice + Packing List + OHBL ou
  Draft BL como conjunto documental recebido.
- Vitest da API passou a desabilitar paralelismo entre arquivos porque testes de
  IA alteram `process.env` antes de importar singletons; isso evita vazamento de
  provider externo e chamada real em suite local.

Validacoes executadas:

- `npm test -w apps/api -- src/modules/validation/checks/__tests__ src/modules/validation/__tests__/service.test.ts src/modules/validation/__tests__/history.test.ts`
- `npm test -w apps/api -- src/modules/documents/__tests__/extraction-history.test.ts`
- `npm test -w apps/api -- src/modules/sydle/__tests__/normalizer.test.ts src/modules/sydle/__tests__/service.test.ts`
- `npm test -w apps/web -- src/features/sydle-payments/SydlePaymentsPage.test.tsx src/features/documents/DocumentList.test.tsx src/features/documents/DocumentComparison.test.tsx src/features/processes/components/ProformasTab.test.tsx src/features/validation/ValidationChecklist.test.tsx`
- `npm run -w apps/api typecheck`
- `npm run -w apps/web typecheck`
- `npm run lint`
- `npm test` (API: 676 passed, 1 skipped; Web: 85 passed)
- `npm run build`
- `npm audit --audit-level=high` (sem vulnerabilidades high; 11 moderadas
  conhecidas em dependencias de tooling)
- `pytest -q` em `apps/cert-api` (325 passed)

Pendencias externas:

- SYDLE ainda depende de contrato/API/payload sanitizado real e credenciais em
  SOPS para habilitar `SYDLE_SYNC_ENABLED=true`.
- Segregacao fina de acesso por papel/escopo na `cert-api` segue decisao de
  negocio/arquitetura.
- Aceite relacional do comparativo documental ainda deve ser modelado em tabela
  propria com hash/versao de evidencias.

## 2026-06-18 - Reprocessamento Invoice DEMO E Resiliencia Documental

Escopo:

- Validar a reclamação da Eduarda no processo demo `264`
  (`DEMO-IM0712602NB-E227210`): invoice reupada aparecia como
  `Processando` por tempo excessivo.

Evidencias em producao:

- Documento `134` estava salvo em `documents` como invoice do processo `264`,
  com PDF local legivel e `ai_parsed_data` anterior indicando falha
  `fetch failed`.
- O parser deterministico da versao atual extraiu do PDF real:
  `invoiceNumber=IM0712602NB`, `exporterName=KIOM GLOBAL LIMITED`,
  `totalFobValue=24312.52` e 7 itens.
- A API autenticada `/api/documents/process/264` passou a retornar a invoice
  `134` como `completed`, confianca `0.7828`; a invoice antiga `55` permanece
  como `failed` e nao entra no comparativo.
- `/api/documents/process/264/comparison` passou a retornar `hasInvoice=true`,
  7 linhas no comparativo por item, exportador correto e FOB conforme.

Correcoes aplicadas:

- `enqueueAIExtraction` agora faz fallback para `processWithAI` quando
  `pg-boss.send()` nao devolve ID de job.
- `POST /api/documents/:id/reprocess` retorna DTO operacional com
  `aiProcessingStatus`, alinhado ao contrato da lista.
- Lista/comparativo diferenciam documento recebido de documento extraido com
  dados úteis; o comparativo mostra aviso de parcialidade quando documento
  obrigatorio está ausente ou sem extracao valida.
- Google Drive raiz com placeholder `your-root-folder-id` passou a ser tratado
  como desconfigurado para upload/movimentacao/relatorios, evitando erro em
  cascata sem afetar a sync Pre-Cons por pasta própria.

Validacoes executadas:

- `npm test -w apps/api -- src/modules/documents/__tests__/service.test.ts src/modules/documents/__tests__/process-with-ai-resilience.test.ts src/modules/documents/__tests__/extraction-history.test.ts`
- `npm test -w apps/api -- src/modules/settings/__tests__/routes.test.ts src/modules/validation/__tests__/service.test.ts src/modules/validation/__tests__/history.test.ts`
- `npm run -w apps/web typecheck`
- `npm run -w apps/api typecheck`
- `npm run lint`
- `npm test`

Pendencia externa:

- Configurar `GOOGLE_DRIVE_ROOT_FOLDER_ID` real no SOPS/env de producao para
  reativar backup/movimentacao automatica no Drive.
- Validar/rotacionar `GOOGLE_CHAT_WEBHOOK_URL`: envio de resumo de validacao
  retornou HTTP 400 no pós-deploy, sem afetar extracao/comparativo.

## 2026-06-18 - Modulo SYDLE De Compras E Pagamentos Internacionais

Escopo:

- Criar modulo novo no portal de importacao para relatorio de compras e
  pagamentos internacionais da SYDLE, com atualizacao automatica a cada 15
  minutos.

Entregue:

- Tabelas `sydle_purchase_payments` e `sydle_sync_runs` em migration
  idempotente `0017_sydle_purchase_payments.sql`.
- Modulo API `apps/api/src/modules/sydle` com cliente, normalizador, service,
  controller, rotas, resumo, listagem, historico de sync, CSV backend e sync
  manual admin-only.
- Scheduler `sydle-sync` registrado em `*/15 * * * *`; quando `SYDLE_*` nao
  esta configurado, grava `status=skipped` sem quebrar a operacao.
- Tela web `/importacao/compras-pagamentos` com KPIs, filtros, tabela desktop,
  cards mobile, exportacao CSV e sync manual para admin.
- Variaveis SYDLE adicionadas a `.env.example`, `.env.sops.yaml.example`,
  `docker-compose.yml` e `docker-compose.prod.yml`.
- Documentacao dedicada `docs/SYDLE-INTEGRATION.md` e atualizacoes em README,
  API, DATABASE, SECRETS, OBSERVABILITY e CHANGELOG.

Validacoes executadas ate aqui:

- `npm test -w apps/api -- src/modules/sydle/__tests__/normalizer.test.ts`
- `npm run -w apps/api typecheck`
- `npm run -w apps/web typecheck`

Pendencia externa:

- Obter contrato real/API/exportacao do projeto SYDLE, endpoint, credencial,
  payload sanitizado e campo incremental para ativar `SYDLE_SYNC_ENABLED=true`.

## 2026-06-18 - Revisao Completa Do Fluxo Documental, Leitura E Validacao

Escopo:

- Revisao cruzada de documentacao, memoria, ADRs, fluxo de documentos, leitura,
  comparativo, validacao, upload, reprocessamento, email ingestion e UX.

Correcoes aplicadas:

- Validacao e deteccao de anomalias passaram a escolher o documento vigente:
  mais recente, processado, com `aiParsedData`, sem falha/skipped e com
  confianca operacional minima. OHBL continua preferido; Draft BL e fallback
  quando OHBL valido nao existe.
- Extração com confiança menor que 40% agora salva evidencia no documento, cria
  alerta critico e nao projeta dados para `import_processes.ai_extracted_data`,
  validacao ou espelho automatico.
- Rebuild de dados projetados e comparativo documental ignoram extracoes
  abaixo do piso de confianca operacional.
- Upload, reprocessamento e exclusao de documentos respeitam processo travado
  (`lockedAt`), retornando erro 423 e removendo arquivo temporario de upload
  quando aplicavel.
- Comparativo documental deixou de usar `invoiceDate` como ETD/embarque e
  passou a usar comparacao estrita de portos normalizados, evitando falso match
  como `SANTOS` vs `SANTOS DUMONT`.
- Upload web ganhou timeout, suporte a `.msg`, preserva escolha manual de tipo
  contra autodeteccao por nome, expõe estado acessivel do seletor e invalida
  comparativo/validacao/processo/eventos relacionados.
- Lista de documentos mostra falha de IA de forma acionavel, diferencia docs
  recebidos de extraidos, expõe origem manual/e-mail quando consultada, abre
  fallback de Drive quando arquivo local falha e oculta reprocess/delete de
  usuarios nao admin.
- Ingestao por e-mail passou a usar `randomUUID()` no nome fisico do anexo,
  evitando colisao por mesmo nome no mesmo milissegundo.
- E2E de documentos foi corrigido para a rota real
  `/api/documents/process/:processId`.
- README e RUNBOOK foram reconciliados: producao usa `AI_PROVIDER=ialocal`,
  egress externo exige `AI_ALLOW_EXTERNAL=true`, e rollback do servidor e por
  snapshot/rsync, nao por `git checkout`.
- Pos-deploy do SHA `7cd31b7` mostrou que `pg-boss` estava sem filas criadas em
  producao: `boss.send('ai-extraction', ...)` retornava `null`, os documentos
  55/134 do processo 264 ficavam `is_processed=false` e `pgboss.queue` estava
  vazia. A inicializacao passou a criar as filas conhecidas antes de registrar
  workers/enviar jobs.
- Apos o hotfix da fila, os jobs de Invoice do processo 264 executaram, mas a
  IA local falhou com `Headers Timeout Error` apos aproximadamente 300s. O PDF
  KIOM tinha texto extraivel, porem em layout compacto/colado; o parser
  deterministico de Invoice passou a cobrir esse formato e a reconhecer FOC sem
  depender da chamada multimodal.

Validacoes executadas ate aqui:

- Suíte completa da API via `npm test -w apps/api`: 570 testes passaram, 1 skip.
- `npm run typecheck`
- `npm run lint`
- Teste focado `npm test -w apps/api -- src/shared/queue/__tests__/index.test.ts`
  cobrindo criacao idempotente das filas.
- Testes focados
  `npm test -w apps/api -- src/modules/ai/utils/__tests__/invoice-text-parser.test.ts src/modules/ai/__tests__/extract-with-upgrade.test.ts`.

Pendencias registradas em `docs/TECH_DEBT.md`:

- E2E documental ponta a ponta com upload multipart real e fixtures anonimizadas.
- Versionamento relacional/snapshot de aceite do comparativo.
- Classificador por conteudo para anexos genericos.
- Dedupe atomico/singleton para reprocessamento concorrente.
- Decisao final sobre fallback permissivo vs estrito em schema Zod da IA.

## 2026-06-18 - Deploy Producao E Fechamento Pos-Auditoria

Correcoes finais aplicadas:

- Deploy oficial concluido em producao via `scripts/deploy.sh` no servidor
  `192.168.168.124`, com backup obrigatorio, snapshot de rollback, migrations,
  rebuild/restart e healthchecks.
- Segredos obrigatorios `GOOGLE_SHEETS_SPREADSHEET_ID` e
  `GRAFANA_ADMIN_PASSWORD` foram adicionados no SOPS remoto e o `.env` passou a
  ser gerado com `docker compose config --quiet` valido.
- Destinatarios operacionais foram mantidos em `system_settings`: KIOM e
  Fenicia preenchidos; ISA permaneceu vazio para cadastro pelo negocio em
  Configuracoes.
- O processo `264` permaneceu sem documentos pendentes de processamento apos a
  correcao da invoice presa.
- O runtime Docker da API foi corrigido com `overrides` locais para
  `imapflow`/`mailparser` usarem o `nodemailer` corrigido. O container final
  ficou com `npm audit --omit=dev --audit-level=high` sem vulnerabilidades.

Validacoes finais executadas:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `npm audit --audit-level=high` em `apps/api`
- Instalacao standalone temporaria de `apps/api` com `npm install --omit=dev`
  e audit high.
- `docker build -t importacao-api-audit ./apps/api`
- `docker run --rm --entrypoint sh importacao-api-audit -lc 'cd /app && npm audit --omit=dev --audit-level=high'`
- Deploys oficiais para `de8d688d5b49` e depois `8170d3dc9a0e`.
- Pos-deploy: containers `importacao-api`, `importacao-web`, `importacao-cert-api`,
  `importacao-redis` e `importacao-postgres` saudaveis; `/health/ready` OK;
  cert-api `ready=True`; rota publica `/importacao/processos/264` respondeu
  `HTTP 200`; logs recentes da API sem `error|exception|fatal|unhandled|oauth`.

## 2026-06-18 - Fase De Fechamento De Pendencias E Acessibilidade Residual

Inventario:

- Varredura cruzou `README.md`, `CHANGELOG.md`, `docs/PROJECT_MEMORY.md`,
  `docs/SESSION_MEMORY.md`, `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md`,
  `docs/ROADMAP.md`, `docs/STATUS-2026-06-16.md`,
  `docs/UX_UI_AUDIT_2026-06-17.md`, codigo web/API e estado git.
- Pendencias P0 ainda abertas dependem de decisao externa ou dado operacional:
  provider de IA, cadastro de destinatarios KIOM/Fenicia/ISA em Configuracoes,
  alerta externo de restore/RTO, pasta/credencial Pre-Cons, escrita Linx e regras
  regulatorias de certificacao/licenciamento/estoque.

Correcoes aplicadas:

- Upload/preview de documentos: HTML removido da allowlist, conteudo ativo
  forca download com `nosniff`, upload no frontend valida extensao/tamanho e
  expoe controle acessivel com progresso.
- Pre-Cons: adicionada migration SQL `0016_pre_cons_tables.sql`; script de
  pending migrations aplica a migration; filtros e headers ordenaveis ganharam
  labels/`aria-sort`.
- CI/deploy/infra: cert-api entrou no build/Trivy/SBOM; deploy GitHub Actions
  usa `scripts/deploy.sh`; defaults sensiveis de WMS/ERP/Sheets/Grafana foram
  removidos; Alertmanager ficou noop por padrao com template de webhook real.
- E2E de API: falha de setup em CI deixa de ser skip silencioso.
- Produtos de Certificacoes: cabecalhos ordenaveis viraram botoes focaveis com
  `aria-sort`; filtros de status e marca passaram a expor `aria-pressed`.
- Agendamentos de Certificacoes: toggles de ativacao da lista e do modal passaram
  a usar `role="switch"` e `aria-checked`; acoes icon-only ganharam `type` e
  nomes acessiveis.
- Configuracoes/Usuarios: toggle de usuario ativo passou a expor semantica de
  switch.
- Seletor global de tema: botao declara aberto/fechado e opcoes usam
  `aria-pressed`, sem prometer comportamento ARIA de menu.
- Rotas internas invalidas de Importacao/Certificacoes agora mostram fallback
  contextual; redirect legado `/processos/*` preserva caminho profundo.
- Sidebar recolhida, headers de layout, login mobile, linhas de tabelas
  navegaveis, abas de processo e botoes icon-only receberam ajustes de
  acessibilidade e responsividade.
- Formularios: processo/cambio validam numeros e datas no frontend/API; edicao
  de processo travado bloqueia campos; cron de agendamento e validado no
  frontend/cert-api; telas de certificacao nao mascaram erro de API como lista
  vazia.
- Assistente IA: adicionado balao flutuante nos layouts de Importacao e
  Certificacoes, com consulta ao endpoint existente `/api/assistant/query`,
  atalhos operacionais, fontes internas e inferencia automatica de processo em
  paginas de detalhe.
- Segurança cert-api: proxy `/cert-api/` passou a validar JWT via
  `auth_request` em `/api/auth/me` antes de injetar `X-API-Key`; client web de
  certificacoes passou a usar `Authorization` em chamadas JSON, multipart,
  downloads e stream de validacao.
- Deploy: `scripts/deploy.sh` agora valida `docker compose config --quiet` no
  servidor depois da geracao de `.env` e antes de migrations/restart.
- Incidente processo 264: invoice `2026.02.22 KIOM INV - IM0712602NB (1).pdf`
  estava presa em `is_processed=false`/`ai_parsed_data=null` desde abril; a API
  recebia polling em `/api/documents/process/264` a cada 5s. Correcoes locais:
  extração enfileirada em `ai-extraction`, falhas de `extractText`/PDF/IA viram
  `failed`, documentos presos passam a `failed` apos
  `DOCUMENT_PROCESSING_STALE_MINUTES`, reprocessamento concorrente retorna 409 e
  abertura/download de PDF no frontend tem timeout visual.
- Auth/OAuth: URL `devolucoes.grupounico.com:3091/api/auth/error?OAuthSignin`
  nao pertence ao fluxo deste repo (`POST /api/auth/google`); `devolucoes:3091`
  resolve para outro host/servico. Neste repo, compose/env agora exigem
  `GOOGLE_CLIENT_ID` e `VITE_GOOGLE_CLIENT_ID` em producao.
- Operacao: destinatarios KIOM/Fenicia/ISA agora sao configurados no sistema em
  Configuracoes, com `KIOM_EMAIL`/`FENICIA_EMAIL`/`ISA_EMAIL` apenas como fallback
  opcional.
- Documentacao reconciliada para retirar a acessibilidade corrigida da divida
  aberta e explicitar que secrets/SOPS ja estao configurados, restando governanca
  continua.

Testes e validacoes executados:

- `npm run -w apps/web typecheck`
- `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`
- `npm test -w apps/web`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `POSTGRES_USER=dummy POSTGRES_PASSWORD=dummy POSTGRES_DB=dummy JWT_SECRET=dummy GOOGLE_SHEETS_SPREADSHEET_ID=dummy WMS_ORACLE_HOST=dummy WMS_ORACLE_PORT=1521 WMS_ORACLE_SID=dummy WMS_ORACLE_USER=dummy WMS_ORACLE_PASS=dummy ERP_PUKET_HOST=dummy ERP_PUKET_DB=dummy ERP_IMG_HOST=dummy ERP_IMG_DB=dummy ERP_MSSQL_USER=dummy ERP_MSSQL_PASS=dummy CERT_API_KEY=dummy GRAFANA_ADMIN_PASSWORD=dummy docker compose -f docker-compose.prod.yml config --quiet`
- `bash -n scripts/deploy.sh`
- `bash -n scripts/apply-pending-migrations.sh`
- `npm test -w apps/api -- src/modules/documents/__tests__/controller.test.ts src/shared/middleware/__tests__/upload.test.ts src/modules/pre-cons/__tests__/parse-precons.test.ts`
- `ruff check apps/cert-api/`
- `pytest apps/cert-api/ --tb=short -q`
- `npx eslint` focado nos TSX alterados
- `npx eslint apps/web/src/shared/components/AssistantBubble.tsx apps/web/src/shared/components/ImportacaoLayout.tsx apps/web/src/shared/components/CertificacoesLayout.tsx`
- `docker run ... nginx:alpine ... nginx -t` para `apps/web/nginx.conf`
- Playwright MCP em 28 rotas x desktop/mobile, com mocks de API, verificando
  overflow, controles sem label, botoes sem nome e rotas invalidas.
- Playwright MCP especifico do balao do Assistente IA em Importacao e
  Certificacoes desktop/mobile: abertura, envio para `/api/assistant/query`,
  fontes, Escape, ausencia de overflow/botoes sem nome e ocultacao na pagina
  dedicada `/importacao/assistente`.
- Playwright MCP limpo em `/importacao/processos/123/rota-invalida` confirmou
  inferencia automatica do ID `123`, zero overflow, zero botoes sem nome e zero
  warnings/erros de console.

Observacoes:

- `npm audit --audit-level=high` ficou sem `high`/`critical`; ainda lista 13
  moderadas e 1 baixa transitivas ja registradas em `docs/TECH_DEBT.md`.
- `docker compose config` local passou com variaveis obrigatorias dummy.
- Deploy nao foi executado nesta fase porque `scripts/deploy.sh` exige worktree
  limpa e `master` sincronizado; `HEAD` e `origin/master` estavam iguais
  (`5a99bf3c351122afc111b05566a787f6a47bd7ab`), mas havia alteracoes locais
  nao commitadas.
- Nova politica de compose prod exige variaveis reais para Sheets/WMS/ERP/Grafana
  antes do proximo deploy.
- Checagem remota em 2026-06-18 indicou `.env` atual do servidor com
  `GOOGLE_SHEETS_SPREADSHEET_ID` e `GRAFANA_ADMIN_PASSWORD` ausentes; o deploy
  com o compose novo deve ser bloqueado ate esses segredos existirem.
- Pendencias residuais registradas em `docs/TECH_DEBT.md`: migrar modais
  especificos restantes para Dialog compartilhado, fortalecer forms de
  Settings/Communications/CertCadastro e criar UX mobile dedicada para tabelas
  largas/kanban.

## 2026-06-17 - Confirmacao Do Envio Fenícia No Espelho

Correcoes aplicadas:

- Botao "Enviar para Fenícia" no preview do espelho passou a abrir confirmacao
  antes do POST real.
- Acao mostra estado de envio, bloqueia duplo clique e fica desabilitada quando
  o espelho ja foi enviado.
- Sucesso invalida `espelho`, `process`, `process-events` e `communications`
  para refletir marco operacional, timeline e comunicacao enviada.

Testes focados executados:

- `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`

## 2026-06-17 - Acessibilidade Do Modal De E-mail De Correcao

Correcoes aplicadas:

- Modal de e-mail de correcao passou a focar o campo de destinatario ao abrir.
- Escape fecha o modal e devolve foco ao botao que abriu o rascunho.
- Navegacao por Tab fica contida dentro do dialogo.
- Campos do rascunho ganharam labels/ids acessiveis e o editor HTML ganhou
  `role="textbox"` com `aria-multiline`.
- Geracao manual de e-mail de correcao passou a reutilizar rascunho KIOM aberto
  do mesmo processo, preservando edicoes humanas.
- `communicationService.send` passou a bloquear envio quando a comunicacao nao
  esta mais em `draft`, evitando reenvio acidental por API.

Testes focados executados:

- `npm test -w apps/api -- src/modules/communications/__tests__/service.test.ts`
- `npm test -w apps/web -- src/features/validation/ValidationChecklist.test.tsx`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Odoo Settings DB Com Fallback Env

Correcoes aplicadas:

- `odoo.service` passou a resolver `odoo_url`, `odoo_db` e `odoo_user` a partir
  de `system_settings`, com fallback para `ODOO_URL`, `ODOO_DB` e `ODOO_USER`.
- `ODOO_PASSWORD` permanece somente em SOPS/env, sem campo novo no banco ou UI.
- O client XML-RPC passou a usar `createClient` para URL `http` e
  `createSecureClient` para URL `https`, preservando path base da URL.
- Cache de autenticação Odoo passa a ser reaproveitado apenas enquanto a
  configuração efetiva permanece igual.

Testes focados executados:

- `npm test -w apps/api -- src/modules/integrations/__tests__/odoo.service.test.ts`
- `npm test -w apps/api -- src/modules/integrations/__tests__/odoo.service.test.ts src/modules/validation/checks/__tests__/document-fixture.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Fallback De Draft BL Na Validacao

Correcoes aplicadas:

- `runAllChecks` passou a selecionar `ohbl` como BL preferencial e usar
  `draft_bl` apenas como fallback quando OHBL ainda nao existe.
- `runAnomalyDetection` passou a usar a mesma regra, evitando anomalia com BL
  vazio quando so ha Draft BL.
- O fallback nao altera o marco operacional de documento final recebido nem
  libera envio Fenícia/espelho como se OHBL existisse.

Testes focados executados:

- `npm test -w apps/api -- src/modules/validation/__tests__/service.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Normalizacao De Chave Google Em SOPS

Correcoes aplicadas:

- Criado `normalizeGooglePrivateKey` para aceitar PEM com quebras reais,
  `\n` escapado ou `\\n` duplamente escapado.
- Drive, Sheets, Gmail ingestion, Google Groups e Vertex passaram a usar o
  helper compartilhado.
- `scripts/generate-env-from-vault.sh` passou a normalizar `*_PRIVATE_KEY`
  antes de escrever `.env`, evitando gerar PEM com barra residual no fim das
  linhas.

Evidencia operacional:

- Pos-deploy de `10d09ca4825c` mostrou `ERR_OSSL_UNSUPPORTED` no job Gmail
  porque `GOOGLE_DRIVE_PRIVATE_KEY` chegava duplamente escapada.

Testes focados executados:

- `npm test -w apps/api -- src/shared/utils/__tests__/google-private-key.test.ts`
- `bash -n scripts/generate-env-from-vault.sh`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Recalculo De `aiExtractedData` Em Delete/Reprocessamento

Correcoes aplicadas:

- Criado `documentService.rebuildProcessAiExtractedData`, que reconstrói
  `import_processes.ai_extracted_data` a partir dos documentos processados
  atuais do processo.
- `reprocess` agora arquiva/zera a extração do documento e reconstrói a
  projeção consolidada dentro da mesma transação antes da nova extração.
- `delete` agora remove a linha do documento e reconstrói a projeção consolidada
  dentro da mesma transação.
- A reconstrução preserva chaves não documentais, escolhe o documento processado
  mais recente por tipo e descarta extrações pendentes, `skipped` ou falhas.

Testes focados executados:

- `npm test -w apps/api -- src/modules/documents/__tests__/service.test.ts src/modules/documents/__tests__/extraction-history.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

## 2026-06-17 - Validacao Documental, Datas Logisticas E Fixtures

Correcoes aplicadas:

- `incoterm-check` passou a extrair o codigo base Incoterms 2020 e aceitar
  variantes comerciais comuns de FOB, como `FOB NINGBO` e `FOB - CHINA`.
- `currency-check` passou a normalizar variantes comuns de USD, incluindo
  `US$`, `U.S.D.`, `USD DOLLARS` e `United States Dollars`.
- `dates-match` passou a comparar apenas campos logisticos de embarque/ETD e
  deixou de usar `invoiceDate` como fallback para shipment.
- Adicionada fixture representativa INV/PL/OHBL/FUP que roda `allChecks` real,
  sem mock, e falha se um conjunto documental coerente produzir `failed`.

Testes focados executados:

- `npm test -w apps/api -- src/modules/validation/checks/__tests__/dates-match.test.ts src/modules/validation/checks/__tests__/incoterm-currency.test.ts src/modules/validation/checks/__tests__/document-fixture.test.ts`

Validacoes completas executadas:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=high`
- `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`

Pendencia mantida:

- Trocar/complementar a fixture representativa por PDFs ou extracoes reais
  anonimizadas quando o negocio liberar amostras.
- Pos-deploy de `e72e8930ce91` confirmou API/cert-api healthy, mas logs antigos
  ainda avisavam `KIOM_EMAIL`, `FENICIA_EMAIL` e `ISA_EMAIL` ausentes em
  producao. A pendencia foi movida para cadastro via Configuracoes, pois depende
  dos enderecos reais do negocio.

## 2026-06-17 - Hardening Cert-API, Fenicia, AuthZ E Dependencias

Analise continuada com subagentes para cert-api/proxy, AuthZ/Fenicia e
dependencias npm.

Correcoes aplicadas:

- `cert-api` passou a falhar fechado quando `CERT_API_KEY` esta ausente; apenas
  `/api/health` e `/api/ready` ficam sem API key.
- Nginx do `web` passou a injetar `X-API-Key` no proxy `/cert-api/` via
  `CERT_API_KEY`; compose de producao exige a variavel para `web` e `cert-api`.
- Proxy dev do Vite tambem injeta `X-API-Key` quando `CERT_API_KEY` existe no
  ambiente local.
- API Node inicializa Redis/cache fora de testes e encerra Redis no shutdown.
- Cadastro de usuarios no frontend ficou restrito aos papeis `admin` e
  `analyst`.
- Rotas criticas passaram a exigir admin: delete de processo, reprocess/delete
  de documento, sync manual de follow-up, delete de item de espelho e envio/marco
  Fenícia.
- "Enviar para Fenícia" agora cria comunicacao, envia SMTP real por
  `communicationService.send` e so marca espelho/processo apos sucesso.
- Dependencias com audit `high` foram removidas: `vite`, `form-data`,
  `@grpc/grpc-js` e `multer` ficaram em versoes corrigidas.

Observacoes:

- `npm audit --audit-level=high` ficou sem `high`/`critical`; restam 13
  moderadas e 1 baixa transitivas registradas em `docs/TECH_DEBT.md`.
- `@googleapis/drive` foi atualizado para major. `testcontainers` v12 foi
  testado, mas voltou para 11.14.0 porque puxou `undici@8` e quebrou E2E local
  com Node 20.

## 2026-06-17 - Revisao Completa Pos-Deploy, Segurança E Operacao

Analise conduzida com subagentes especializados em backend/RAG/seguranca,
frontend/UX e DevOps/producao.

Correcoes aplicadas:

- Assistente operacional nao usa mais fontes com score zero; pergunta sem
  evidencia positiva retorna resposta deterministica sem fontes e sem chamada IA.
- Auditoria no assistente com `processId` filtra `entityType = process`.
- Comunicacoes validam allowlist de destinatarios antes do envio SMTP.
- Envio registra `userId` real em auditoria/evento e assinatura e validada pelo
  usuario autenticado.
- Ingestao de e-mail usa mailbox normalizado para allowlist e Vimbar, evitando
  substring no header `From`.
- Pre-Cons recebido por e-mail passa por limite de tamanho, tipo suportado e
  magic bytes antes do parser XLSX.
- Query booleana de ingestao corrige `includeRead=false` e `allSenders=false`.
- Logs de e-mail aceitam filtro backend por `processId`/`processCode`; detalhe
  do processo deixou de filtrar apenas os 50 recentes no frontend.
- Busca manual de e-mails no detalhe de documentos fica restrita visualmente a
  admins, alinhada ao backend.
- Exportacao CSV de alertas/atendimentos busca todas as paginas dos filtros
  ativos.
- Editor de e-mail de correcao salva/envia o corpo atual mesmo sem blur.
- Deploy aborta em falha de migration antes de subir api/web novos.
- Backup inclui volume `cert-certs` e arquiva volumes persistentes via Docker
  mount, sem depender de permissao direta em `/var/lib/docker/volumes`.
- Healthchecks de Docker passam a usar readiness real de API e cert-api.
- Deploy recria `cert-api` junto com API/Web e valida readiness do servico.
- API libera `/metrics` para rede privada Docker apenas com flag explicita.
- Restore testado em producao em 2026-06-17 usando
  `importacao_2026-06-17_203311.pgdump`: 30 tabelas e 273 processos restaurados
  em banco temporario, com cleanup concluido.
- SOPS + age configurado em producao: chave privada somente no servidor, chave
  publica em `.sops.yaml`, `.env.sops.yaml` criptografado e versionado.
- Restore test semanal agendado no crontab do servidor aos domingos 03:20, com
  log em `/home/nicolas/importacao/logs/restore-test.log`.

Testes executados:

- `npm run typecheck`
- `npm run lint`
- `npm test` (API 514 passed / 1 skipped; Web 30 passed)
- `npm test -w apps/web`
- `npm run build`
- `docker compose -f docker-compose.prod.yml config --quiet`

Observacoes:

- Build web manteve o warning conhecido de CSS `@import`.
- `docker compose config` local avisou `ERP_MSSQL_USER`/`ERP_MSSQL_PASS`
  ausentes porque o `.env` de producao nao estava carregado.

## 2026-06-17 - Harness Validacao, FOB, Portos E Deploy

Alteracoes entregues no commit `997aac4`:

- Checklist de validacao separa falhas abertas, atencoes abertas, aceitos e conformes.
- Aceite manual deixa de contar como falha aberta.
- Botoes de email de correcao aparecem apenas quando ha falha aberta.
- Revalidacao invalida checklist, relatorio, comparativo, processo, eventos e comunicacoes.
- FOB passou a classificar item comercial, FOC/amostra/brinde e ajuste/desconto.
- Desconto negativo e FOC com valor positivo sao tratados como divergencia explicada quando reconciliam o FOB declarado.
- Portos normalizam acento, pais por sigla/nome, parenteses e barra.
- Prefix match inseguro em portos foi removido.
- Falta total de porto de descarga vira `warning`.
- Anomalia deterministica nao soma FOC/desconto como item comercial.

Testes executados:

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`

Deploy:

- SHA `997aac4` publicado em `192.168.168.124`.
- Backup pre-deploy: `/home/nicolas/backups/importacao/importacao_2026-06-17_110416.pgdump`.
- Pos-deploy: `importacao-api` e `importacao-web` healthy; `/health/ready` OK.

Pendencias identificadas:

- Ver `docs/KNOWN_ISSUES.md` e `docs/TECH_DEBT.md`.

## 2026-06-17 - Memoria E Governanca Do Harness

Criados arquivos para operacionalizar o prompt mestre:

- `AGENTS.md`
- `docs/HARNESS_PROMPT.md`
- `docs/PROJECT_MEMORY.md`
- `docs/SESSION_MEMORY.md`
- `docs/KNOWN_ISSUES.md`
- `docs/TECH_DEBT.md`
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/SECURITY.md`
- `docs/DEPLOY.md`
- `docs/OBSERVABILITY.md`
- `docs/PERFORMANCE.md`
- `docs/ROADMAP.md`
- `docs/ADR/README.md`

Observacao:

- `docs/adr/` continua sendo o diretorio canonico de ADRs ja existentes.

## 2026-06-17 - Revisao UX/UI, Dados E Seguranca

Analise conduzida com tres subagentes especializados:

- UX/UI, rotas, navegacao e botoes.
- Duplicidade de fetch/cache e informacao exibida.
- Dominio de importacao, leitura de documentos, invoice/espelho/BL, validacoes e e-mails.

Correcoes aplicadas:

- Removida busca global falsa dos sidebars.
- Incluido `Meu Dia` no menu e no titulo do layout.
- Corrigido titulo global de edicao de processo.
- Adicionados alvos `#main` para skip link em Login, Portal e Certificacoes.
- Melhorada acessibilidade de menu, logout, abas, filtros de data, lista de documentos e lista de processos.
- E-mails e cambios do detalhe de processo reutilizam dados ja carregados quando possivel.
- Removido bloco duplicado de dados extraidos no card de Informacoes do Processo.
- Fechado vetor critico de anexo por `path` livre em comunicacoes.
- Ingestao manual de e-mail passou a exigir admin para trigger, varredura historica e reprocessamento.
- Anexo de e-mail passa a respeitar limite maximo de 50 MB ou `EMAIL_ATTACHMENT_MAX_BYTES`.

Documento de auditoria:

- `docs/UX_UI_AUDIT_2026-06-17.md`

Testes executados:

- `npm run -w apps/web typecheck`
- `npm test -w apps/web`
- `npm run -w apps/api typecheck`
- `npm test -w apps/api`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Observacao:

- `npm test -w apps/api -- --runInBand` nao e suportado pelo Vitest atual; a suite padrao passou.

## 2026-06-17 - Assistente RAG, Relatorios CSV E Nomenclatura

Alteracoes aplicadas:

- Criado modulo `apps/api/src/modules/assistant` com rota autenticada `POST /api/assistant/query`.
- Assistente recupera fontes internas de processos, alertas, atendimentos/e-mails, e-mails recebidos, validacoes, documentos, follow-up, eventos, auditoria para admin e base RAG existente.
- `aiService.generateOperationalAssistantAnswer` usa as fontes recuperadas para resposta em PT-BR e cai para resumo deterministico quando a IA falha.
- Criada pagina `/importacao/assistente` com pergunta, filtro opcional por processo, atalhos e fontes clicaveis.
- Menu de Importacao padronizado para `Assistente`, `Atendimentos` e `Central de Alertas`.
- Alertas e atendimentos ganharam exportacao CSV baseada nos filtros atuais.
- Nomenclatura revisada em paginas centrais: alertas, atendimentos, auditoria, detalhe de processo, e-mails, cambios, LIs, dashboard, follow-up, validacao e documentos.

Verificacoes ja executadas nesta sessao:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run lint` final apos ajustes de teste/texto

Pendencias antes de deploy:

- Commit, push e `scripts/deploy.sh`.

## 2026-06-18 - Auditoria Feedback Eduarda/Leticia E Invoice DEMO 264

Contexto:

- Feedback operacional revisado contra codigo, documentacao e producao.
- Producao consultada no processo `264` (`DEMO-IM0712602NB-E227210`).

Evidencias de producao:

- Documento `2026.02.22 KIOM INV - IM0712602NB (1).pdf` estava como
  `type=invoice` e `is_processed=true`, mas sem `exporterName`, sem
  `invoiceNumber`, sem datas logisticas e com `items=0`.
- Packing List, OHBL, Draft BL e Espelho tinham dados parciais/itens; a falha
  principal do Comparativo era a invoice antiga sem dado util, nao ausencia de
  aba ou botao.
- SKU `050402313` em producao: `last_validation_status=URL_NOT_FOUND`,
  `is_expired=true`, `sale_deadline=07/12/2025`; a derivacao atual retorna
  `cert_status=ENCERRADO`, `site_status=CONFORME`,
  `license_status=NAO_APLICAVEL`, `comercializacao_status=ENCERRADA`.

Correcoes aplicadas nesta sessao:

## 2026-06-24 - Revisao 100% Documentos/IA/E-mails/Insights

Contexto:

- Revisao profunda solicitada para remover `[object Object]`, tornar a extracao
  documental mais completa, revisar fluxo de coleta de e-mails e expor insights
  operacionais dos processos.
- Auditoria dividida em frentes: documentos/IA/OCR, e-mail ingestion, banco/DW
  e frontend/QA.

Correcoes aplicadas:

- `DocumentsTab` deixou de renderizar objetos com `String(value)` e passou a
  resumir dados consolidados por tipo documental.
- `ProcessInfoCard`, `DraftBLTab` e `AiExtractionSummary` passaram a
  desembrulhar `{ value, confidence }` e renderizar objetos como resumo humano.
- Comparativo documental ganhou painel de diagnostico de extracao com leitura
  ponderada, campos nao lidos e baixa confianca.
- Cobertura ponderada no backend agora contabiliza campos obrigatorios que
  sequer vieram no JSON da IA.
- Draft BL passou a usar upgrade por baixa confianca e self-repair.
- Parser de BL ganhou teste deterministico e correcoes para captura de navio,
  portos, container, peso, free time e NCM.
- Gmail/IMAP deixaram de marcar e-mails como lidos durante o fetch; o marcador
  so e removido apos log terminal persistido.
- Query manual, historica e double-check de Gmail permanecem restringidas por
  `EMAIL_ALLOWED_SENDERS`; o processador tambem valida allowlist sempre.
- Anexos de e-mail passam a registrar SHA-256, origem da mensagem, indice do
  anexo, caminho local, Drive inbox e flag de orfao/recuperavel no JSONB.
- Migration `0020_document_lineage_and_email_dedupe.sql` adiciona tabelas para
  anexos de e-mail, runs de extracao, campos extraidos e aceite relacional.
- Ingestao por e-mail passou a deduplicar anexos por `processId + SHA-256`
  antes de chamar `documentService.upload`.
- Novas extracoes documentais passam a persistir run e campos extraidos em
  tabelas relacionais com hash do texto fonte, provider/modelo e confianca.
- Aceite de comparativo passou a persistir em `comparison_acceptances` com hash
  de evidencia; reprocessamento/insercao de nova extracao invalida aceites
  ativos do processo.
- Anexos genericos (`other`) agora tentam classificacao textual por conteudo
  PDF/XLSX antes de ficarem para revisao manual.

Validacoes executadas:

- `npm run typecheck -w apps/api`
- `npm run typecheck -w apps/web`
- `npm test -w apps/api -- src/modules/ai/utils/__tests__/bl-text-parser.test.ts src/modules/documents/__tests__/service.test.ts src/modules/email-ingestion/__tests__/sender-policy.test.ts src/modules/email-ingestion/__tests__/classify-document.test.ts --run`
- `npm test -w apps/web -- src/features/documents/AiExtractionSummary.test.tsx src/features/documents/DocumentComparison.test.tsx src/features/processes/components/ProcessInfoCard.test.tsx --run`
- `npm test -w apps/api -- src/modules/email-ingestion/__tests__/schema.test.ts src/modules/email-ingestion/__tests__/sender-policy.test.ts src/modules/email-ingestion/__tests__/classify-document.test.ts src/modules/email-ingestion/__tests__/processor-codes.test.ts src/modules/email-ingestion/__tests__/vimbar-detection.test.ts --run`
- `git diff --check`
- `npm run lint`
- `npm test`
- `npm run build`

Pendencias estruturais:

- OCR/preprocessamento dedicado para PDFs escaneados e screenshots continua
  pendente porque nao ha engine OCR local configurada no projeto; o fluxo atual
  cobre texto PDF/XLSX, parsers deterministicos, IA/VLM quando aplicavel e
  classificacao textual de conteudo.

## 2026-06-25 - Otimizacao IA/Vertex e teto diario

Contexto:

- Nicolas pediu revisao da IA com Vertex para otimizar uso e nao gastar tokens a toa,
  incluindo revisao do bloqueio de R$100/dia.

Decisoes/correcoes:

- `assertBudgetAvailable` passou a receber `estimatedCostUSD` e bloquear por
  `gasto atual + custo estimado da proxima chamada`, tanto no teto mensal quanto
  no diario (`AI_DAILY_BUDGET_BRL`).
- `aiService.chat()` agora estima tokens de entrada por tamanho do prompt e aplica
  caps de saida por contexto antes de chamar provider pago.
- Caps default: Invoice/PL/Proforma 16384, Espelho 12288, BL/Draft BL 6144,
  Cert/LI 4096, analises 1024/512, self-repair 768, assistente 768.
- Self-repair continua disponivel, mas em Vertex/OpenRouter fica desligado por
  padrao (`AI_SELF_REPAIR_PAID=0`) para evitar reenviar documento inteiro em uma
  segunda chamada sem autorizacao explicita.
- `.env.example` e schema de ambiente documentam/validam os novos controles.

Verificacoes:

- `npm test -w apps/api -- --run src/modules/ai/__tests__/cost-tracker-budget.test.ts src/modules/ai/__tests__/provider-selection.test.ts src/modules/ai/__tests__/extract-with-upgrade.test.ts src/modules/ai/providers/__tests__/vertex.test.ts src/modules/ai/__tests__/cost-tracker.test.ts`
- `npm run typecheck -w apps/api`
- `npm run lint`
- `npm test -w apps/api`
- `npm run build`

- Documento processado sem dado util extraido deixou de contar como lido.
- `aiParsedData` vazio, com campos `{ value: null }`, string vazia ou lista de
  itens vazia nao projeta dados em `aiExtractedData`.
- Comparativo, validacao e deteccao de anomalias passaram a ignorar documentos
  sem dado util, mesmo que estejam `isProcessed=true`.
- Nova extracao IA que retorna sucesso sem dado util passa a ser marcada como
  `extractionFailed`, com alerta critico para reprocessar/reclassificar.

Status dos pedidos:

- Importacao: FOC/desconto, centralizacao no Comparativo, filtros,
  `Aceitar`, comparativo por item, normalizacao de portos, ETD com tolerancia,
  log de checklist e Proformas estao implementados. A invoice do processo 264
  ainda depende de reprocessamento/reupload apos deploy desta correcao.
- Importacao pendente de decisao UX: unificar `Atendimentos` e `E-mails`.
- Certificacao: tela principal ja mostra `Status Certificacao`,
  `Cert. - Prazo`, `Status Ecommerce`, `Status Licenciamento` e
  `Licen. - Prazo`; exportacoes/relatorios ainda tem nomenclatura legada
  `Status`/`Prazo Venda`.
- Certificacao pendente de dado/regra: prazo de licenciamento separado nao
  existe na fonte atual; estoque CD usa disponivel do WMS, nao necessariamente
  estoque fisico do relatorio externo da Leticia.

Testes locais executados:

- `npm test -w apps/api -- src/modules/documents/__tests__/service.test.ts`
- `npm test -w apps/api -- src/modules/documents/__tests__/process-with-ai-resilience.test.ts`
- `npm test -w apps/api -- src/modules/validation/__tests__/service.test.ts`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm test`
- `npm run build`

## 2026-06-18 - Ajuste Fino Qualidade Extracao/Validacao DEMO 264

Contexto:

- Revisao solicitada para confirmar se a extração documental esta 100% e se a
  qualidade da leitura/comparativo esta adequada apos o destravamento da
  invoice do processo `264`.
- Producao confirmou todos os 6 documentos do processo como `completed`, com
  invoice `IM0712602NB`, exportador `KIOM GLOBAL LIMITED`, total FOB
  `24312.52` e 7 itens extraidos.

Correcoes aplicadas:

- Comparativo por item passou a normalizar prefixos `FATxx` vindos do Packing
  List antes de comparar com a Invoice.
- Validacao de unidade passou a tratar `PC`, `PCS`, `PCE` e `PIECE(S)` como
  equivalentes de `UN`, sem relaxar `PAR` e `SET/KIT`.
- Validacao de fabricante passou a usar sufixos de descricao da invoice como
  fallback conservador (`--FINE TEXTILE`, `--A&C`) e rejeitar sufixos genericos
  como FOC/amostra.
- Validacao de datas passou a usar `skipped` quando existe zero ou apenas uma
  data logistica, evitando atencao falsa quando nao ha contraparte documental
  para comparar.
- Extração IA documental passou a ter timeout global
  `DOCUMENT_AI_EXTRACTION_TIMEOUT_MS` (default 180s), para transformar OCR/IA
  pendurado em falha operacional explicita em vez de spinner indefinido.

Verificacoes executadas:

- `npm test -w apps/api -- src/modules/validation/utils/__tests__/item-code-normalize.test.ts src/modules/validation/checks/__tests__/item-level-match.test.ts src/modules/validation/checks/__tests__/unit-type-validation.test.ts src/modules/validation/checks/__tests__/manufacturer-completeness.test.ts`
- `npm test -w apps/api -- src/modules/documents/__tests__/process-with-ai-resilience.test.ts src/modules/documents/__tests__/service.test.ts`
- `npm test -w apps/api -- src/modules/validation`
- `npm run -w apps/api typecheck`
- `npm run -w apps/web typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

Observacao operacional:

- Apos deploy, reexecutar validacao do processo `264` em producao para
  confirmar reducao dos falsos positivos; avisos restantes esperados tendem a
  ser dados ausentes/externos (FOC explicado, FUP/Odoo/NCM/data logistica
  ausente), nao travamento de extracao.

## 2026-07-10 — Rollout documental e validação PK2052602TJ

- Deploy de produção concluído nos commits `d5a7f36` e `739f63a`; revision
  remota `739f63aa79f6`.
- Migration 0024 aplicada; OCR local está ativo com Poppler/Tesseract e
  idiomas `por+eng`; mailbox de ingestão persistido em SOPS como
  `global@grupounico.com`.
- Full resync SYDLE manual concluído: 26 atualizações, sem erro.
- Reprocessamento de oito documentos do processo PK2052602TJ terminou pela
  fila pg-boss. Documentos 43, 147, 148, 149 e 150 extraíram; invoices 44,
  146 e 151 falharam de modo explícito e devem ser revisadas manualmente.
- Descoberto e corrigido: `reconcileProcessConfidence` não deve recalibrar
  documentos com `extractionFailed`/`error`. O patch publicado preserva
  confiança zero e impede projeção enganosa; dados existentes afetados foram
  reparados em produção.

## 2026-08-17 — Limpeza historica e replay solicitado pela Odett

- Dry-run confirmou 274 processos, 170 anteriores a 2025-05-01, 17 sem ETD
  nao-DEMO e o DEMO 264 com 11 documentos.
- Dump e uploads foram copiados; `pg_restore --list`, `tar -tzf` e restore
  integral em banco temporario passaram antes da mutacao.
- A limpeza serializavel removeu exatamente 170 processos. O fechamento trouxe
  104 processos, nenhum anterior ao corte, 17 sem ETD e o DEMO intacto.
- Replay canonico: 37 documentos/19 processos; 32 completaram e 5 falharam.
  Tres uploads concorrentes completaram dois e adicionaram uma falha. Estado
  terminal corrente: 34 completos, 6 falhos, 0 processando.
- Todos os 19 processos foram reconciliados via API e revalidados com 29 checks;
  fila nao terminal = 0, leases = 0, alertas Chat na janela = 0.
- Compose normal restaurado; readiness confirmou PostgreSQL e Redis e o proxy
  respondeu. Drive root continua no placeholder historico, portanto inativo.
- Os seis documentos em quarentena sao 28, 76, 88, 92, 151 e 154. Nao repetir
  em massa; revisar arquivo/classificacao e reprocessar individualmente.

## 2026-08-17 — Retorno Leticia: certificacao, descricao e PI7223Y

- Auditoria em paralelo confirmou Imaginarium/Puket H/P/V e Encerramentos G/H.
- Puket Escolares tinha bug real: `tipo` casava C (ESTOJO/LANCHEIRA); a nova
  coluna correta e D. Layout corrigido para D/E/H/I e coberto por sentinelas.
- O relatorio de validacao comparava com a descricao correta, mas exibia o tipo
  como Texto Esperado. JSON e XLSX agora separam Tipo Certificacao da Descricao
  E-commerce efetivamente comparada.
- Contagem atual: 14 SKUs efetivamente sem descricao; nenhum escolar. Os 41 eram
  a fotografia de 07/08. Ha 15 conflitos entre duplicatas, ainda last-write-wins.
- PI7223Y conferido ao vivo: WMS 7 fisicos, 7 reservados, 0 disponiveis; ERP
  e-commerce 28. O 0/28 esta correto. Painel/XLSX agora rotulam CD disponivel e
  o painel mostra o detalhe 0/7 mesmo quando todas as unidades estao reservadas.
- Nenhum deploy ou sync de certificacao foi executado nesta sessao.

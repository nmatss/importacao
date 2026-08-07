# Known Issues

Ultima atualizacao: 2026-08-07 (ver
`docs/STATUS-2026-08-07-CERTIFICACAO-RELATORIO-ESTOQUE.md`,
`docs/STATUS-2026-08-07-DUIMP-PK2052602TJ.md`,
`docs/STATUS-2026-08-03-LOGIN-GOOGLE.md` e
`docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md`)

## ALTO - Estoque De Certificacao Sem Agendamento Proprio

Descricao:

- Ate 2026-08-07 a tabela `cert_stock` inteira (33.416 linhas) datava de
  23/03/2026: o unico registro em `cert_schedules` roda apenas a validacao VTEX,
  e `/api/sync-stock` so era acionado manualmente.
- A correcao fez o sync de estoque pegar carona no caminho `source="sheets"`,
  entao ele passa a rodar uma vez por dia junto do cron das 06:00.

Impacto:

- Estoque no painel e no relatorio pode ficar ate 24h defasado, e um problema no
  cron de validacao leva o estoque junto sem alerta proprio.

Status:

- **PARCIAL / ALTO.** `cert_schedules` nao tem coluna de tipo de job, entao nao
  da para cadastrar um agendamento so de estoque sem migration. Registrado em
  `docs/TECH_DEBT.md`.

## MEDIO - Produtos Ativos Sem "Descricao E-commerce" Na Planilha

Descricao:

- 41 dos 567 produtos das abas de produto estao com a coluna V ("Descricao
  E-commerce") vazia na planilha STATUS CERTIFICACAO.
- Ate 2026-08-07 isso ficava escondido porque o sync caia para
  `certification_type` quando a coluna V estava vazia — o que gerava comparacao
  contra texto que nao e frase de certificacao.
- Com a correcao, `expected_cert_text` e exclusivamente a coluna V. Sem ela o
  produto sai como `NAO_CONFORME` com a frase "Frase de certificacao obrigatoria
  ausente no cadastro".

Impacto:

- Esses 41 SKUs aparecem como nao conformes ate o time fiscal preencher a coluna
  V. O status esta correto: a frase realmente nao esta cadastrada.

Status:

- **ABERTO / MEDIO.** Depende de preenchimento na planilha (time fiscal).

## ALTO - Login Google Intermitente Por Gateway Docker Da API

Descricao:

- Em 2026-08-03, Leticia, Eduarda e Odett tiveram nove tentativas de login
  bloqueadas entre 09:16 e 09:19 BRT.
- O frontend recebeu HTTP 401, mas a causa real foi `ETIMEDOUT` da API ao obter
  token em `oauth2.googleapis.com` para validar o Google Group.
- A API esta nas redes `importacao_default` e `ia-local-net`; seu default
  gateway aponta para `ia-local-net`, cuja origem `192.168.208.4` nao possui
  egress funcional. A origem `172.20.0.9` de `importacao_default` acessa o
  Google normalmente.

Impacto:

- Todos os logins Google e integracoes externas originadas pela API podem
  falhar de forma intermitente.
- O health check continua verde porque valida somente API, PostgreSQL e Redis.
- Timeouts de infraestrutura sao apresentados incorretamente como HTTP 401.

Status:

- **ABERTO / ALTO.** Houve login bem-sucedido das tres usuarias as 11:37 BRT,
  mas um probe posterior voltou a falhar; o sucesso temporario nao encerra o
  incidente.
- Correcao recomendada: fixar `importacao_default` como gateway prioritario via
  `gw_priority`, manter `ia-local-net` para a IA local, recriar a API pelo fluxo
  aprovado e executar a matriz de validacao registrada em
  `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`.
- Nenhuma mudanca de producao foi aplicada durante o diagnostico.

## ALTO - Reprocessamento Integral Nao Possui Orquestrador Seguro

Descricao:

- A API expoe reprocessamento unitario, mas nao possui batch ID, dry-run,
  selecao canonica, retomada ou exclusao mutua de lote.
- Existem 73 versoes excedentes em 28 grupos `processo + tipo`; reprocessar
  todas pode fazer documento historico competir com a versao operacional.
- Cada documento pode disparar validacao, reconciliacao, upload/relatorio no
  Drive, movimento de pasta e alerta no Google Chat.
- O rate limiter usa `req.path` na chave; IDs diferentes nao formam um limite
  global efetivo para o lote.

Impacto:

- Limpeza antecipada de dezenas de documentos enquanto aguardam o worker.
- Validacoes repetidas, transicoes de workflow, ruido de alertas e arquivos
  duplicados em integracoes externas.
- Lote interrompido nao tem checkpoint operacional para retomada segura.

Status:

- **PARCIALMENTE MITIGADO / ALTO. 2026-08-07:** `scripts/reprocess-documents.mjs`
  cobre dry-run por padrao, batch ID, retomada por JSONL, selecao canonica,
  exclusao do processo 264 e ritmo proprio de requisicao, tudo sobre as rotas
  HTTP existentes (nenhuma escrita direta no banco).
- Continua ABERTO no lado do servidor: nao ha modo de manutencao para diferir
  validacao, Drive e Google Chat, nem exclusao mutua entre lotes concorrentes.
  Enquanto isso, o lote so deve rodar em janela combinada com a operacao.

## MEDIO - Assuntos De E-mail Da Rodada DUIMP Nao Existem No Portal

Descricao:

- Os unicos assuntos gerados pelo portal sao `Documentos de Importação - {codigo}
  - {marca}` (`templates/fenicia-submission.ts`), `Correção Necessária - ...`
(`templates/kiom-correction.ts`) e `Certificação ISA - ...`
(`templates/isa-certification.ts`).
- A thread real Odett/Eduarda do processo PK2052602TJ usa outros dois padroes,
  que nao tem template correspondente: `Rascunho DUIMP PUK PK2052602TJ //
DOCUMENTOS` (rodada de conferencia do rascunho) e `REGISTRO DUIMP PUK016/26 -
PK2052602TJ` (aviso de registro).
- O segundo padrao depende da referencia Fenicia (`PUK016/26`), que o portal nao
  guarda em coluna alguma de `import_processes` — `purchase_ref` e a referencia
  de compra, nao a da Fenicia. A referencia esta impressa nos dois PDFs
  (`Referência externa` no rascunho, `REFERENCIA FENICIA` no extrato), mas
  `duimpResponseSchema` nao extrai o campo.

Impacto:

- A rodada de rascunho e o aviso de registro continuam sendo escritos a mao; o
  portal nao consegue reproduzir o assunto que a Fenicia usa para arquivar.

Status:

- **ABERTO / MEDIO.** Precisa de decisao: promover a referencia Fenicia a coluna
  de `import_processes` + campo do extractor DUIMP, e so entao criar os dois
  templates no modulo `communications`.

## ALTO - Lease De Extracao De Producao Menor Que O Timeout Do Job

Descricao:

- Producao usa `DOCUMENT_EXTRACTION_LEASE_MS=600000` (10 minutos).
- A extracao de texto/OCR pode durar 20 minutos e o job `ai-extraction` expira
  em 25 minutos.

Impacto:

- Uma extracao longa pode perder a lease e permitir trabalho concorrente ou
  duplicado antes do encerramento do job original.

Status:

- **ABERTO / ALTO antes do lote.** Ajustar para no minimo `1500000` e validar o
  comportamento em piloto.

## MEDIO - Base Documental Exige Triagem Antes Do Reprocessamento Integral

Descricao:

- Dos 26 documentos `other` fora do DEMO, o classificador sugeriu 6 proformas,
  4 invoices e 1 Draft DUIMP; 15 continuam inconclusivos.
- Dois espelhos canonicos sao PDF e nao sao aceitos pelo parser deterministico
  atual; o fallback de IA do espelho nao esta habilitado.

Impacto:

- Reprocessar `other` apenas os marca sem extractor e gera alerta.
- Reprocessar os espelhos PDF repete a falha sem melhorar os dados.

Status:

- **ABERTO / MEDIO.** Confirmar as 11 reclassificacoes, triar manualmente os 15
  restantes e substituir/reclassificar os 2 espelhos PDF.

## Para fechar o "100%" — itens de DADO/CONFIG (nao codigo) — 2026-06-22

Vertex ligado e funcionando (prod `b55968a`; **issue #60 FECHADA em 2026-07-17** — a SA
dedicada `gemini-n8n` segue pendente, passos no fechamento da issue). O teto de extracao
agora e a QUALIDADE DO INPUT, nao a IA (ver `docs/STATUS-2026-06-22.md`); telemetria de
acuracia com corpus real rastreada na **issue #100**. Pendencias que so a equipe resolve:

- **Reclassificar "KIOM PI" existentes (proforma)**: ~30+ docs reais com nome "KIOM PI -..."
  estavam como `invoice`/`other`. O classificador da ingestao foi CORRIGIDO (token `pi` ->
  proforma) — vale p/ NOVOS uploads. Os antigos no banco precisam `type -> proforma_invoice`
  - reprocesso. ⚠️ Muda estado de validacao (proforma nao conta como invoice recebida) —
    executar com a operacao ciente. (Relatorio de candidatos disponivel; reclassificacao em
    lote nao foi auto-aplicada de proposito.)
- **Higienizar documentos**: re-subir `.xlsx` que sao imagem como **PDF**; trocar
  **screenshots** por documentos reais; dividir PDFs escaneados muito grandes (timeout 180s).
  (XLSX em si JA e lido pelo extractText; o problema sao misclassificacao/screenshot/tamanho.)
- **Destinatarios de e-mail (#78)**: cadastrar em Configuracoes > E-mails > Destinatarios
  operacionais. A tela foi reorganizada em 2026-06-29 para deixar a allowlist no topo.
- **Aba "Licenciamentos Vencidos" sem coluna de data**: "Licen. - Prazo" (#11) fica vazio
  ate a planilha ganhar uma coluna de validade (o Status #10 ja funciona via coluna "Produto").
- **Sydle (#3a)**: campos financeiros sensiveis (cambio/banco/remessa) seguem em 403 — liberar
  acesso/view sanitizada para popular cambio, BRL, banco, contrato e remessa. As colunas do
  relatório Analytics/CSV foram preservadas no staging em 2026-07-08 e podem ser reprocessadas
  por full resync via `POST /api/sydle/sync-now?full=1`.
- **Webhook Google Chat**: key invalida nas notificacoes (`chat.googleapis.com` 400) — config.
- **Vertex SA dedicada** (opcao profissional): mover Vertex p/ `gemini-n8n` (least-privilege)
  com `roles/aiplatform.user` — hoje reusa a SA compartilhada `n8n-automacao`.

## Feedback Odett 2026-07-09 - Dependencias Para Declarar 100%

- **Processo real `PK2052602TJ`:** o codigo foi ajustado para global mailbox,
  OHBL x Espelho, pesos/volumes, frete via OHBL, comparativo por item,
  fabricantes e SYDLE, mas a comprovacao 100% ainda depende de fixtures reais
  anonimizadas ou reprocessamento em base com os documentos reais.
- **DUIMP/Draft DUIMP:** a aba Registro compara campos do processo contra Draft
  DUIMP/DUIMP Final por aliases comuns e prioriza a DUIMP final; se os documentos
  reais usarem nomes de campo diferentes, sera preciso adicionar aliases
  especificos apos validar a fixture.
- **Fornecedores/fabricantes:** existe quadro por item INV/PL/Espelho e suporte a
  aliases de rodape da Invoice (`manufacturerAliases`), mas a comparacao de dados
  completos com base mestre depende de a operacao fornecer a planilha/base mestre
  ou confirmar que os aliases extraidos bastam.
- **Follow-Up ↔ planilha:** a integração está disponível por comparação/sync
  administrativo por processo, mas não tem job automático. Antes de ativá-lo é
  necessário confirmar a planilha-fonte, frequência e se divergências devem
  apenas alertar ou sobrescrever o portal; ativar escrita automática sem essa
  regra cria risco de sobrescrita operacional.
- **Mailbox de ingestão:** código tem fallback para `global@grupounico.com`,
  porém uma configuração explícita de produção pode prevalecer. Confirmar
  `GMAIL_SHARED_MAILBOX=global@grupounico.com` no rollout evita processar a
  caixa errada.

## Backlog do feedback da Eduarda 2026-06-21 (nao bloqueante; pos PR #99)

- **Packing List com itens ainda abaixo do esperado em alguns PDFs:** `fillPackingListNullsFromText`
  ja cobre escalares de header no caminho do LLM. O ponto restante e item tabular em PDF com
  texto ruim/colunas coladas ou scan; nesses casos depende de reprocesso com texto pesquisavel
  ou melhoria especifica a partir de fixture real anonimizavel.
- **Coluna "Sistema" no comparativo POR ITEM:** o painel agregado "Documentos vs Sistema"
  ja existe, mas a sugestao da Eduarda de ter a coluna Sistema tambem no quadro por item
  exige validacoes de sistema em **nivel de item** no backend (`documents/service.ts`
  `getComparison` so produz checks de sistema agregados). Redesenho, nao bug.
- **Reconcile de anomalias (7-vs-1) sob erro de BD — NAO e bug:** `reconcileItemAnomalies`
  faz fail-open (mantem anomalias da IA se `getComparison` falhar) em vez de esconde-las
  durante um outage. Comportamento intencional/documentado; sem acao.
- **Extracao "78% da Invoice" / datas Invoice+PL:** parcialmente coberto por
  `fillInvoiceNullsFromText` + comparativo ETD com tolerancia ampla (PR #99). O teto de
  qualidade (invoices escaneadas sem OCR, itens) continua no modelo local → Vertex (#60).

## Follow-ups do review enterprise 2026-06-20 (nao bloqueantes p/ staging)

- **Sydle signIn (P0 ABERTO — bloqueio externo):** credenciais (login/senha) vao na
  QUERY STRING do `signIn`, podendo vazar em logs de proxy/WAF. Tentativa de mover
  para POST body FALHOU em producao (`HTTP 405` — a SYDLE One so aceita GET no
  signIn, verificado 2026-06-20). Mitigacao client-side quebra a auth. **Acao
  (externa):** verificar se a SYDLE oferece auth por TOKEN/header/POST; ate la,
  restringir/limpar access logs do proxy e **rotacionar `SYDLE_PASSWORD`**
  periodicamente. Codigo revertido para GET funcional em `sydle/client.ts`.
- **DBA P1 — matchProcess full scan:** `importProcesses.aiExtractedData::text ILIKE`
  no sync varre a tabela. **Fix:** `pg_trgm` + indice GIN, ou promover PO/PI/CI a
  colunas indexaveis. (`sydle/service.ts` matchProcess.)
- **QA P1-A sistemico — erro vira "tela vazia":** ~11 telas com `useApiQuery` que
  nao releem `error`/`isError` (EspelhoPreview, FollowUpTab, CambiosTab, EmailsTab,
  DraftBLTab, AuditLogPage, ExecutiveDashboardPage, etc.). Corrigidos nesta rodada:
  Certificacao "Verificar" (P1-B) e DocumentComparison (P1-G). **Fix restante:**
  padronizar `ErrorState`+retry (modelo: `SydlePaymentsPage`).
- **Sydle regra de pagamento (RESOLVIDO em 2026-07-09):** pago/aberto por parcela
  nao deriva mais da conclusao do ticket; o conector SYDLE One usa `paymentData`
  para `paidAt`, valor pago, saldo e status. Risco residual: se a SYDLE nao
  enviar data/status/valor de pagamento na parcela, a linha permanece aberta e
  depende de liberacao/mapeamento do campo correto na origem.
- **DBA P2 — journal Drizzle parado em 0010:** migrations 0011-0019 aplicadas por
  runner manual (`migrate.ts` + `apply-pending-migrations.sh`). Reconciliar journal/snapshots.
- **DevOps:** rede Docker externa `ia-local-net` e `.env` de producao sao pre-requisitos
  de staging; destinatarios de e-mail (#78) e Drive root precisam de config.

## CRITICO - Go-live Publico Bloqueado Por Upstream Do Nginx/Edge

Descricao:

- O deploy operacional do SHA `3f36137a697fee9f4f1011bc3eace3417467d5be`
  concluiu em `192.168.168.124` com backup, migrations, containers e health
  interno OK.
- A URL publica `https://importacao.grupounico.com/` ainda retorna `HTTP/2 502`
  com header `server: nginx`, portanto o acesso externo nao esta apto para
  go-live.
- A topologia correta confirmada e Nginx/edge externo terminando TLS e fazendo
  proxy reverso para o Nginx interno do app em `192.168.168.124:8085`.
- A causa operacional identificada foi a publicacao do `web` apenas em
  `127.0.0.1:8085`, que funciona para health local, mas impede o Nginx/edge
  externo de alcançar o upstream.

Evidencias:

- `REVISION` remoto: `3f36137a697fee9f4f1011bc3eace3417467d5be`.
- `importacao-api`, `importacao-web` e `importacao-cert-api` em estado
  `healthy` no servidor.
- API interna `http://127.0.0.1:3050/health/ready` retorna `status=ok`.
- Web interna `http://127.0.0.1:8085/` retorna 200.
- Cert-api readiness passou dentro do container em `/api/ready` com
  `ready=True`.
- `curl https://importacao.grupounico.com/` retorna 502 `server: nginx`.
- `docker-compose.prod.yml` foi corrigido para publicar `8085:80` e remover
  labels/rede Traefik do `web`.

Impacto:

- Usuarios externos continuam sem acesso confiavel pela URL oficial, apesar de
  a aplicacao estar saudavel internamente.
- O sistema nao deve ser declarado em go-live publico ate o dominio responder
  200 em HTTPS e uma chamada API autenticavel via dominio publico funcionar.

Status:

- Em correcao. Requer deploy do compose corrigido e validacao publica com:
  `curl -fS https://importacao.grupounico.com/` e uma chamada API via dominio
  oficial.

## ALTO - Extração De Cabeçalho, Portos E Datas Pode Depender Do Provider

Descricao:

- Analise anterior do DEMO apontou que documentos existiam, mas campos de cabeçalho/portos/datas vinham nulos ou fracos na extracao.

Evidencias:

- `docs/STATUS-2026-06-16.md`
- `apps/api/src/modules/ai/service.ts`
- `apps/api/src/modules/ai/skills/registry.ts`

Impacto:

- Comparativo e validacao funcionam quando os campos existem, mas qualidade de extracao afeta sintomas operacionais.

Status:

- Aberto. Vertex vs IA local permanece decisao de produto/privacidade/custo.

## ALTO - Destinatarios Operacionais De Email Pendentes De Cadastro

Descricao:

- Producao anterior subia com warnings para `KIOM_EMAIL`, `FENICIA_EMAIL` e
  `ISA_EMAIL` ausentes.
- Desde a revisao de 2026-06-18, esses destinatarios devem ser cadastrados em
  `Configuracoes > Destinatarios operacionais`; env permanece apenas fallback
  opcional.
- `communicationService.send` bloqueia envio quando `recipientEmail` esta vazio.
- `COMMUNICATION_ALLOWED_RECIPIENTS` agora tambem e repassado ao container `api`
  em compose, mas continua sendo fallback: o cadastro na tela segue como fonte
  operacional preferida.

Evidencias:

- Logs remotos de 2026-06-18 em `importacao-api`.
- `apps/api/src/modules/settings/operational-recipients.ts`
- `apps/api/src/modules/communications/service.ts`
- `docs/STATUS-2026-06-16.md`

Impacto:

- Emails de correcao para KIOM, envio real para Fenicia e fluxo ISA ficam
  bloqueados ate que os enderecos reais sejam configurados em
  `Configuracoes > Destinatarios operacionais`.

Status:

- Parcial. Codigo/compose aceitam o fallback `COMMUNICATION_ALLOWED_RECIPIENTS`,
  mas ainda requer confirmacao/cadastro dos enderecos operacionais reais na tela
  de Configuracoes para nao depender de env.

## MEDIO - SYDLE Campos Complementares Limitados Por Permissao

Descricao:

- A fonte real Sydle One para pagamentos internacionais foi validada em
  2026-06-19 com login `sys/auth/signIn` e busca
  `POST /api/1/main/_classId/68bf1179b042c72f03993928/_search`.
- A classe `Solicitacao de Pagamento Internacional/current` retornou
  solicitacoes reais e parcelas em `paymentData[]`; o portal ja possui
  normalizacao para uma linha por parcela.
- O usuario/API atual consegue ler a solicitacao principal, ticket, status e
  moeda, mas buscas diretas nos formularios `InternationalPaymentOpenForm` e
  `RequestData` retornaram 403. Assim, fornecedor, PI, invoice e processo de
  importacao podem permanecer vazios ate haver permissao adicional ou uma visao
  SYDLE consolidada.
- Nao ha evidencia local suficiente para afirmar que nao existem outras classes
  SYDLE relevantes; a confirmacao depende de catalogo/permissao da SYDLE. A
  alternativa preferida e uma view/API read-only consolidada, sanitizada, com
  `processCode`, `purchaseRef`, `purchaseOrder`, `piNumber`, `invoiceNumber`,
  `supplierName`, status/tipo real da parcela, pagamento/liquidacao, cambio,
  BRL, banco, contrato e remessa.
- Enquanto `SYDLE_SYNC_ENABLED=false` ou faltar alguma variavel de
  `sydle_one_class`, o job de 10 minutos registra `status=skipped`.
- `scripts/deploy.sh` aborta se `SYDLE_SYNC_ENABLED=true` no `.env` remoto,
  salvo rollout aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.

Evidencias:

- `docs/SYDLE-INTEGRATION.md`
- `apps/api/src/modules/sydle`
- `apps/web/src/features/sydle-payments/SydlePaymentsPage.tsx`

Impacto:

- A tela e o relatorio podem sincronizar dados reais de valores, vencimentos,
  status do ticket e moeda.
- A conciliacao automatica com processos de importacao pode ficar limitada ate a
  SYDLE fornecer PI/invoice/processo/fornecedor no payload acessivel.
- Risco operacional residual: confirmar com financeiro/comex se a regra
  `ticket concluido = pago` e `ticket em andamento = aberto` representa o fluxo
  final.

Status:

- Aberto. Requer UAT financeiro e ajuste de permissao/API para campos
  complementares, preferencialmente por view/API consolidada da SYDLE em vez de
  ampliar leitura de payload bruto sensivel.

## MEDIO - Pasta Raiz Do Google Drive Ausente Em Producao

Descricao:

- Em 2026-06-18, a producao tinha credenciais Google Drive validas, mas
  `GOOGLE_DRIVE_ROOT_FOLDER_ID=your-root-folder-id`.
- O codigo agora trata esse placeholder como raiz desconfigurada e pula
  upload/movimentacao/relatorios no Drive sem quebrar extração, validacao ou
  Pre-Cons.

Evidencias:

- Logs de reprocessamento do processo `264` tentavam consultar o folder
  `your-root-folder-id` e recebiam 404 do Google Drive.
- `apps/api/src/modules/integrations/google-drive.service.ts`
- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/modules/validation/service.ts`

Impacto:

- Documentos continuam salvos localmente e a extração/comparativo funcionam.
- Backup/movimentacao automatica para a arvore operacional do Drive fica
  desativada ate configurar o folder ID real.

Status:

- Aberto. Requer preencher `GOOGLE_DRIVE_ROOT_FOLDER_ID` real no SOPS/env de
  producao e compartilhar a pasta com a service account do Drive.

## BAIXO - Webhook Do Google Chat Retorna 400

Descricao:

- Em 2026-06-18, apos reprocessamento/validacao do processo demo `264`, o
  envio de resumo para Google Chat retornou HTTP 400.
- `GOOGLE_CHAT_WEBHOOK_URL` está configurado e aponta para domínio Google, mas
  o destino rejeitou a mensagem.

Evidencias:

- Log da API: `Google Chat webhook failed`, `status=400`.
- `apps/api/src/modules/alerts/google-chat.service.ts`
- `apps/api/src/modules/validation/service.ts`

Impacto:

- Extração, validação, comparativo, e-mails e alertas internos continuam
  funcionando.
- Notificações externas no Google Chat podem não chegar até corrigir o webhook
  ou o formato permitido pelo espaço.

Status:

- Parcial. Em 2026-06-19 o service passou a registrar status HTTP e corpo
  truncado quando o webhook retorna erro; ainda falta validar/rotacionar o
  webhook do espaço Google Chat e testar envio real.

## MEDIO - Frescor Do Estoque WMS/E-commerce No Relatorio

Descricao:

- O relatorio `Estoque Detalhado (WMS + E-commerce)` le o cache `cert_stock`.
- Se `/api/sync-stock` falhar parcialmente, o XLSX pode combinar fontes com
  horarios diferentes.

Evidencias:

- `apps/cert-api/app/services/wms_service.py`
- `apps/cert-api/app/routes/reports.py`
- `apps/cert-api/app/services/report_service.py`

Impacto:

- Usuario pode interpretar estoque antigo como atual se o sync falhou antes da
  exportacao.

Status:

- Parcial. Em 2026-06-19 o XLSX passou a incluir `Sincronizado em` e a UI passou
  a sanitizar erro parcial de sync; falta regra de SLA para bloquear exportacao
  quando a fonte estiver velha.

## MEDIO - Validacao Usa `ohbl` Como BL Principal

Descricao:

- `runAllChecks` monta `blData` a partir de documento `ohbl`; `draft_bl` tem fluxo proprio e nem sempre substitui OHBL ausente.

Evidencias:

- `apps/api/src/modules/validation/service.ts`
- `apps/api/src/modules/documents/service.ts`

Impacto:

- Processo com Draft BL antes do OHBL pode ter validacoes incompletas.

Status:

- Resolvido em 2026-06-17. `runAllChecks` e `runAnomalyDetection` continuam
  preferindo `ohbl`, mas usam `draft_bl` como fallback parcial quando o OHBL
  ainda nao existe. Draft BL nao altera o marco de documento final recebido.

## ALTO - Acao "Enviar Para Fenicia" Do Espelho Nao Envia E-mail

Descricao:

- O fluxo de espelho exposto como envio para Fenicia marca o espelho como enviado e avanca status, mas nao dispara e-mail real.

Evidencias:

- `apps/web/src/features/espelhos/EspelhoPreview.tsx`
- `apps/api/src/modules/espelhos/controller.ts`
- `apps/api/src/modules/espelhos/service.ts`

Impacto:

- Usuario pode acreditar que o envio externo aconteceu quando o sistema apenas registrou marco interno.

Status:

- Resolvido em 2026-06-17. `sendToFeniciaByProcess` agora cria a comunicacao Fenícia, envia via SMTP real usando allowlist/anexos auditaveis de `communicationService.send`, e so marca o espelho/processo apos envio bem-sucedido.

## MEDIO - Incoterm E Moeda Sao Validacoes Restritivas

Descricao:

- Regras atuais tendem a aceitar formatos exatos. Variantes como `FOB NINGBO`, `FOB - CHINA`, `US$` ou `U.S.D.` precisam ser confirmadas e cobertas.

Evidencias:

- `apps/api/src/modules/validation/checks/incoterm-check.ts`
- `apps/api/src/modules/validation/checks/currency-check.ts`

Impacto:

- Pode gerar falso positivo em documento comercial com formato comum.

Status:

- Resolvido em 2026-06-17. `incoterm-check` extrai o codigo base Incoterms
  2020 e aceita variantes comuns de `FOB`; `currency-check` normaliza variantes
  comuns de USD como `US$`, `U.S.D.` e `USD DOLLARS`.

## MEDIO - Delete/Reprocessamento Pode Deixar `aiExtractedData` Obsoleto

Descricao:

- Delete de documento remove arquivo/linha, mas dados consolidados em `import_processes.ai_extracted_data` podem permanecer ate novo calculo explicito.

Evidencias:

- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/shared/database/schema.ts`

Impacto:

- Comparativo, card do processo ou gate operacional podem considerar dados de documento que ja foi removido.

Status:

- Resolvido em 2026-06-17. `reprocess` e `delete` de documentos agora
  reconstroem `import_processes.ai_extracted_data` a partir dos documentos
  processados restantes, preservando chaves nao documentais e descartando
  extrações falhas/pendentes.

## MEDIO - Datas Misturam Invoice Date E ETD/Shipment Em Alguns Checks

Descricao:

- Ha risco de comparar data de emissao da invoice contra data de embarque quando campos de embarque nao foram extraidos.

Evidencias:

- `apps/api/src/modules/validation/checks/dates-match.ts`
- auditoria multi-agente de 2026-06-17 registrada na conversa operacional.

Impacto:

- Falsos positivos ou falsos conformes em ETD/embarque.

Status:

- Resolvido em 2026-06-17. `dates-match` passou a comparar apenas campos
  logisticos de embarque/ETD e deixou de usar `invoiceDate` como fallback.
  Quando a invoice so contem data de emissao, o check registra aviso ou compara
  os demais documentos sem tratar a emissao como embarque.

## MEDIO - Odoo Settings DB Vs Env

Descricao:

- UI/settings podem salvar chaves Odoo no banco, mas o service le variaveis de ambiente.
- Ha risco adicional se URL `http://` for usada com client seguro.

Evidencias:

- `apps/api/src/modules/integrations/odoo.service.ts`
- `apps/web/src/features/settings/SettingsPage.tsx`

Impacto:

- Configuracao feita pela UI pode parecer salva, mas nao afetar a integracao real.

Status:

- Resolvido em 2026-06-17. `odoo.service` agora resolve `odoo_url`,
  `odoo_db` e `odoo_user` a partir de `system_settings` com fallback para env,
  mantendo `ODOO_PASSWORD` somente em SOPS/env. O client XML-RPC agora usa
  `createClient` para `http` e `createSecureClient` para `https`.

## BAIXO - `.env.sops.yaml` Ausente Em Producao

Descricao:

- Deploy registra warning e usa `.env` existente no servidor.

Evidencias:

- `scripts/deploy.sh`
- `docs/STATUS-2026-06-16.md`
- deploy de 2026-06-17.

Impacto:

- Governanca de secrets incompleta, mas deploy segue funcionando.

Status:

- Resolvido em 2026-06-17. Producao recebeu SOPS + age, `.env.sops.yaml`
  criptografado e `scripts/generate-env-from-vault.sh` passa a gerar `.env` a
  partir do arquivo criptografado durante o deploy.

## BAIXO - Warning CSS De `@import`

Descricao:

- Build web emite warning: `@import rules must precede all rules`.

Evidencias:

- `npm run build` em 2026-06-17.

Impacto:

- Nao bloqueia build, mas deve ser limpo.

Status:

- Resolvido em 2026-06-17. Imports CSS foram reordenados para deixar regras
  `@import` antes das demais diretivas.

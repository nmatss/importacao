# Project Memory - Importacao

Ultima atualizacao: 2026-08-26

## Objetivo

Sistema de gestao de importacoes do Grupo Uni.co para Puket e Imaginarium,
incluindo processos de importacao, documentos, validacoes, espelhos, follow-up,
comunicacoes, assistente operacional RAG, certificacoes, dashboards
operacionais e relatorio SYDLE de compras/pagamentos internacionais.

Evidencias:

- `README.md` descreve o sistema e os modulos.
- `docs/STATUS-2026-06-16.md` consolida estado recente, deploys e decisoes.
- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md` define o fluxo operacional de importacao.

Grau de confianca: alto.

## Limpeza Historica E Replay De 2026-08-17

- A regra operacional aprovada preserva `etd >= 2025-05-01`, preserva ETD nulo
  por nao provar antiguidade e preserva sempre o DEMO 264.
- Um backup PostgreSQL custom-format e um tar do volume de uploads devem passar
  validacao e restore test antes de qualquer nova limpeza destrutiva.
- A execucao de 2026-08-17 removeu 170 processos e terminou com 104. O DEMO
  manteve 11 documentos; nao houve FK orfa nem codigo duplicado.
- O replay deve usar documento canonico por `process_id + type`, excluir
  `other` e espelho PDF, operar um processo por vez, esperar estado terminal e
  registrar JSONL para retomada.
- Estado apos a janela: 40 documentos canonicos, 34 concluidos e seis invoices
  isoladas em falha terminal (IDs 28, 76, 88, 92, 151 e 154).
- O valor normal de `DOCUMENT_EXTRACTION_LEASE_MS` continua 600000 e e menor
  que o pior timeout; a janela usou 1500000 apenas como override.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` de producao continua no placeholder
  `your-root-folder-id`; o Drive ja estava inativo e nao foi alterado pela
  operacao.

Evidencias:

- `docs/STATUS-2026-08-17-LIMPEZA-REPROCESSAMENTO.md`
- `docs/operations/backfill-plan-2026-08-17-process-cleanup-reprocess.yaml`
- `docs/operations/release-gate-evidence-2026-08-17-process-cleanup-reprocess.yaml`

Grau de confianca: alto para banco, fila e API; alto para a lista de falhas,
apurada no estado terminal corrente.

## Arquitetura Atual

Monorepo npm workspaces com:

- `apps/api`: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, Redis, pg-boss.
- `apps/web`: React 18, Vite, Tailwind CSS.
- `apps/cert-api`: Python FastAPI para certificacoes, VTEX, ERP/WMS e relatorios.
- `docker-compose.yml` e `docker-compose.prod.yml`: orquestracao dev/prod.
- `scripts/deploy.sh`: deploy de producao com backup, snapshot de rollback, rsync, rebuild e health check.

Evidencias:

- `README.md`
- `docker-compose.prod.yml`
- `.github/workflows/ci.yml`
- `scripts/deploy.sh`

Grau de confianca: alto.

## Dominio De Negocio

Fluxo central:

1. Processo nasce manualmente, por Pre-Cons ou email.
2. Documentos entram por upload ou email ingestion.
3. Sistema classifica e extrai invoice, proforma, packing list, BL, draft BL,
   draft DUIMP, DUIMP, espelho, LI e certificados.
4. Dados alimentam card do processo, validacoes, comparativo e espelho.
5. Operador corrige, aceita divergencia com justificativa ou reprocessa.
6. Follow-up, milestones, alertas, comunicacoes e auditoria registram o ciclo.
7. Assistente operacional RAG responde perguntas sobre processos, atendimentos,
   alertas, documentos e validacoes usando fontes internas recuperadas.

Evidencias:

- `docs/REVISAO-IMPORTACAO-WORKFLOW-2026-06-17.md`
- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/modules/validation/service.ts`
- `apps/web/src/features/processes/ProcessDetailPage.tsx`

Grau de confianca: alto.

## Regras De Negocio Importantes

- Invoice tem prioridade sobre espelho para campos equivalentes no card do processo.
- Espelho pode preencher campos antes da invoice; fonte visual amarela para espelho, verde para invoice.
- Validacao possui status `passed`, `failed`, `warning`, `skipped`.
- Validacao parcial e diagnostica: pode gerar evidencias e alerta operacional,
  mas nao deve promover processo, abrir correcao final, mover pasta ou gerar
  comunicacao KIOM.
- Validacao final exige o check sistemico `document-set-completeness` aprovado:
  Invoice, Packing List e OHBL/Draft BL utilizaveis.
- Cada validacao final deve registrar uma linha canonica em `validation_runs` e
  vincular resultados atuais/historicos/correcoes ao `validation_run_id` na
  mesma transacao de persistencia.
- Aceite manual exige justificativa e nao altera o dado original.
- Edicao manual do comparativo geral fica em `comparison_field_overrides`, com
  auditoria e evento do processo; nao altera o dado extraido original.
- Modelos de atendimento e assinaturas sao configuracoes operacionais acessiveis
  a usuarios autenticados; SMTP, integracoes e destinatarios operacionais seguem
  restritos a admin.
- Etapas especificas e Erros/Custos Extras sao registros por processo, auditados
  e separados do fluxo logistico canonico.
- FOC/desconto nao deve reabrir falso positivo de FOB quando identificado.
- Portos precisam ser normalizados para pais/sufixo, mas sem aceitar prefixo inseguro.
- Documentos ausentes devem gerar `skipped` ou `warning`, nao falsa conformidade.
- Documentos com falha de extracao, sem dados uteis ou abaixo da confianca
  operacional minima nao devem alimentar `aiExtractedData`, comparativo,
  validacao ou indicadores verdes de documento extraido.
- O marco `documents_received` aceita Invoice + Packing List + OHBL ou Draft BL.
- Historico de extracao deve ser consultavel por processo para manter auditoria
  mesmo apos delete do documento original.
- Falha de contrato Zod da IA deve ser preservada em `_trust.contractFailure` e
  derrubar a confianca abaixo do piso operacional, mantendo evidencia para
  revisao humana sem alimentar validacao automatica.
- Comunicacoes nunca devem aceitar anexo por `path` livre do cliente; anexo precisa ser resolvido por documento/espelho autorizado do mesmo processo.
- Comunicacoes podem ter copia fixa operacional (`default_cc_email` /
  `COMMUNICATION_DEFAULT_CC`); destinatarios principais continuam validados por
  allowlist/padroes permitidos.
- O campo urgente do processo e operacional/manual, visualmente vermelho e
  persistido em `import_processes.urgent_note`.
- Trigger, varredura historica e reprocessamento manual de e-mail ingestion sao operacoes administrativas.
- Exportacoes CSV de alertas e atendimentos devem refletir os filtros atuais da tela, evitando relatorios duplicados com o mesmo dado.
- Assistente operacional deve responder somente com fontes internas; se a IA falhar, o fallback deterministico deve explicar as evidencias encontradas.
- Reprocessamento integral deve excluir o processo DEMO por identificador
  estavel (`process_id=264`), selecionar somente a versao canonica mais recente
  por `processo + tipo` e preservar versoes antigas como evidencia, sem faze-las
  competir pela projecao operacional.
- "100% operacional" documental significa estado terminal auditavel para cada
  documento canonico: extraido/utilizavel ou falho/quarentenado com causa e
  acao explicitas. Nao significa elevar artificialmente confianca ou declarar
  todos os documentos conformes.
- Reprocessamento em massa deve diferir efeitos derivados e executar rebuild,
  reconciliacao e validacao uma unica vez por processo ao final. Drive, Chat,
  relatorios e movimentos de pasta nao devem ocorrer para cada documento do
  lote.

Evidencias:

- `apps/web/src/features/processes/components/ProcessInfoCard.tsx`
- `apps/web/src/features/validation/ValidationChecklist.tsx`
- `apps/api/src/modules/validation/checks/fob-calculation.ts`
- `apps/api/src/modules/validation/utils/port-normalize.ts`

Grau de confianca: alto.

## Baseline De Reprocessamento Documental - 2026-08-03

Inventario read-only de producao, excluindo o DEMO `264`:

- 121 documentos em 25 processos; 121/121 arquivos presentes;
- 99 processados e 22 pendentes;
- 28 grupos duplicados, com 73 versoes excedentes;
- 40 documentos canonicos antes da triagem de `other`;
- 11 sugestoes deterministicas de reclassificacao entre 26 `other`;
- 15 `other` ainda inconclusivos;
- 44 canonicos apos simulacao das reclassificacoes;
- 2 espelhos PDF incompativeis com o parser atual;
- lote executavel planejado: 42 canonicos, sendo 39 via IA e 3 espelhos XLSX,
  distribuidos por 21 processos.

Bloqueios anteriores ao lote:

- executor admin-only, resumivel e com dry-run;
- modo de manutencao para Drive/Chat/validacao;
- `DOCUMENT_EXTRACTION_LEASE_MS` alinhado em 25 minutos;
- backup novo de PostgreSQL e `uploads`;
- triagem dos `other` e espelhos PDF;
- piloto real com criterios de go/no-go;
- tratamento separado de processo `completed`.

O fluxo existente preserva historico antes de limpar a extracao, mas nao
oferece restauracao por API. Rollback sistemico depende de backup e nao desfaz
efeitos externos no Drive/Chat.

Evidencia canonica:

- `docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md`

Grau de confianca: alto para inventario e arquitetura; medio para custo e tempo
do lote; classificacoes sugeridas exigem confirmacao humana.

## Dados E Banco

Fonte principal:

- `apps/api/src/shared/database/schema.ts`
- migrations `apps/api/drizzle/0000` ate `0025`

Tabelas centrais observadas:

- `users`
- `import_processes`
- `documents`
- `process_items`
- `validation_results`
- `validation_runs`
- `validation_result_history`
- `document_extraction_history`
- `follow_up_tracking`
- `communications`
- `alerts`
- `process_events`
- `email_ingestion_logs`
- `settings`
- `ai_usage_log`
- `sydle_purchase_payments`
- `sydle_sync_runs`

Grau de confianca: medio-alto. A lista deve ser revisada contra todo `schema.ts`
quando houver mudanca de dados.

## Integracao SYDLE

Estado:

- Modulo tecnico entregue em 2026-06-18.
- Sync automatico agendado a cada 10 minutos.
- Rotas `/api/sydle/*` e tela `/importacao/compras-pagamentos` restritas a
  administradores.
- A tela tambem aparece no menu `Importacao > Operacional >
Compras/Pagamentos SYDLE` e no atalho `Pagamentos SYDLE` do portal para
  administradores.
- A UI do relatorio deve expor os campos financeiros relevantes recebidos da
  SYDLE: cambio, valor BRL, banco, contrato, remessa, datas de
  pagamento/agendamento, motivo de conciliacao e timestamps SYDLE/Portal.
- Desde 2026-07-08, `sydle_purchase_payments` tambem preserva as colunas do
  relatório SYDLE Analytics/CSV: protocolo, datas de emissão/criação/embarque,
  exceção, motivo e prazo de pagamento pós-embarque.
- Desde 2026-07-08, o relatorio SYDLE nao usa estimativas financeiras do portal:
  câmbio, BRL, banco, contrato e remessa só aparecem quando a SYDLE fornece.
- O relatorio SYDLE deve manter visão em tabela para leitura operacional e
  permitir exportar o filtro ativo em CSV, Excel (.xlsx) e PDF; a tela tambem
  exibe uma visão unificada com as colunas do Excel/CSV. Leitura/exportacao,
  menu lateral e atalho do portal sao para usuarios autenticados com acesso ao
  modulo de importacao; sincronizacao manual, configuracao, historico de sync e
  payload bruto ficam restritos a admin.
- Feedback Odett 2026-07-08: a visão/exportação unificada SYDLE nao deve exibir
  as colunas duplicadas `Código do processo` e `Compra`; conciliação deve ficar
  como `Conciliação Portal`/`Evidência conciliação`, com evidências traduzidas
  para linguagem de negócio. Cards financeiros devem exibir valores completos,
  não abreviados, e exports devem usar datas/valores formatados para Excel.
- Feedback Odett 2026-07-09: quando a SYDLE não fornece processo em linhas de
  PI, a coluna `Processo` deve usar `Número Invoice` como fallback e sinalizar
  `PI`/`INV` na UI. Pagamento por parcela deve vir de `paymentData`
  (`paidAt`/status/valor pago/saldo), nunca da finalização do ticket.
- Entrega do feedback Odett implantada em producao no commit `716725d`
  (`716725d285fd` no deploy). Status auditavel registrado em
  `docs/STATUS-2026-07-08-SYDLE-FEEDBACK.md`, incluindo backup pre-deploy,
  health checks e mensagem para resposta operacional.
- Cursor incremental usa maior `sourceUpdatedAt`/`updatedAt` da fonte com
  overlap de 5 minutos e parser de data/hora PT-BR; nao usa horario local de
  inicio como cursor. Quando mapeamento muda, usar full resync administrativo
  (`POST /api/sydle/sync-now?full=1`) para reprocessar historico via API SYDLE.
- Matching financeiro nao deve conciliar automaticamente com invoice/PI/pedido
  isolado; exige processo exato, compra forte ou evidencias combinadas.
- `raw_payload` e sanitizado antes de persistir chaves sensiveis comuns.
- Em 2026-06-19, a fonte real Sydle One foi validada via
  `SYDLE_SOURCE_TYPE=sydle_one_class`: login `sys/auth/signIn`, cookie de
  sessao e `POST /api/1/main/_classId/68bf1179b042c72f03993928/_search`.
- A classe `68bf1179b042c72f03993928` (`Solicitacao de Pagamento
Internacional/current`) retornou 14 solicitacoes e `paymentData[]`; o portal
  achata cada parcela em linha financeira com `externalId`
  `sydle-one:{requestId}:{paymentId}`.
- O usuario/API atual consegue resolver ticket, status, moeda e `requestData`
  suficiente para invoice, processo, emissao Invoice/PI, criacao da tarefa,
  embarque, tipo de pagamento real (`depositInAdvance`, `beforeShipment`,
  `afterShipment`), prazo por parcela e estado de pagamento da parcela quando
  `paymentData` fornece data/status/valor pago. Campos financeiros sensiveis
  (cambio/BRL/banco/contrato/remessa) ainda dependem de permissao adicional ou
  view sanitizada da SYDLE.
- `scripts/deploy.sh` bloqueia deploy se `SYDLE_SYNC_ENABLED=true`, salvo
  rollout financeiro aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.
- Sync real usa SOPS/env com `SYDLE_SYNC_ENABLED=true`,
  `SYDLE_SOURCE_TYPE=sydle_one_class`, `SYDLE_BASE_URL`, `SYDLE_USER`,
  `SYDLE_PASSWORD`, `SYDLE_CLASS_ID` e `SYDLE_DATE_FIELD`.
- Em producao, commit `5362dd3a343a955c4e694cde3df457c92b99c512` habilitou o
  sync real. A primeira sync manual criou 20 parcelas sem erro; o cron seguinte
  buscou 2 registros no overlap e atualizou sem duplicar linhas.
- Totais iniciais da fonte real: 20 linhas, USD 154.847,83 comprados,
  USD 57.142,08 pagos e USD 97.705,75 em aberto.

## Integracao Google Drive

Estado:

- Credenciais Google podem estar configuradas para Pre-Cons/Sheets mesmo quando
  a pasta raiz operacional nao esta.
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` vazio ou `your-root-folder-id` deve ser tratado
  como Drive operacional desconfigurado; upload, movimentacao e relatorios no
  Drive devem degradar sem afetar extração, comparativo ou validacao.
- Para reativar a arvore operacional, preencher o folder ID real no SOPS/env e
  compartilhar a pasta com a service account.

Evidencias:

- `docs/SYDLE-INTEGRATION.md`
- `apps/api/src/modules/sydle`
- `apps/web/src/features/sydle-payments/SydlePaymentsPage.tsx`

Grau de confianca: alto para a arquitetura interna, classe Sydle One validada e
campos do `requestData` observados em producao; medio para campos financeiros
complementares que continuam bloqueados por permissao/view externa.

## IA E Harness

Estado atual de producao recente:

- `AI_PROVIDER=ialocal` por padrao.
- `AI_ALLOW_EXTERNAL=false` por padrao.
- `AI_USE_SPECIALIST=1` por padrao em compose/env schema.
- Skills e harness vivem em `apps/api/src/modules/ai/skills` e `apps/api/src/modules/ai/harness`.
- RAG operacional usa `apps/api/src/modules/assistant/service.ts` com recuperacao lexical sobre tabelas internas e base `apps/api/src/modules/ai/knowledge`.
- Ha documentacao historica que recomenda Vertex para qualidade/privacidade, mas o status mais recente registra IA local em producao e Vertex como decisao pendente.

Evidencias:

- `docker-compose.prod.yml`
- `apps/api/src/shared/config/env.ts`
- `docs/STATUS-2026-06-16.md`
- `docs/AI-HARNESS.md`
- `docs/IA-ESPECIALISTA.md`

Grau de confianca: alto para estado de codigo; medio para estrategia futura, pois depende de decisao humana.

## Infraestrutura E Deploy

- Producao conhecida: `192.168.168.124`.
- Deploy atual por `scripts/deploy.sh`.
- O script faz backup PostgreSQL, snapshot de rollback, rsync, rebuild de `api` e `web`, migrations pendentes e health check.
- Banco e Redis expostos apenas localmente/internamente conforme compose prod.
- A API precisa permanecer simultaneamente nas redes `importacao_default` e
  `ia-local-net`: a primeira atende os servicos do compose e o egress externo;
  a segunda permite acesso ao gateway on-prem da IA local.
- Incidente de 2026-08-03 confirmou que o default gateway da API pode cair em
  `ia-local-net` e perder egress para Google/SYDLE. A correcao duravel deve
  declarar `gw_priority` para `importacao_default`, sem remover `ia-local-net`.
- **Aplicado em 2026-08-14** (SHA `0b5393e`): `docker-compose.prod.yml` declara
  `gw_priority: 100` em `default` e `-100` em `ia-local-net` para o servico
  `api`. Sem isso a falha reincide a cada recriacao do container — o deploy de
  2026-08-14 provou, porque o container voltou a receber o mesmo IP
  `192.168.208.4` e so nao quebrou por causa da prioridade.
- O incidente foi continuo de 2026-08-01 17:38 UTC (reboot do host) a
  2026-08-14 16:20 UTC: 1.864 execucoes do `sydle-sync` falharam sem um unico
  sucesso, e o `/health/ready` ficou verde o tempo todo. Detalhes, linha do
  tempo e pendencias em `docs/INCIDENTE-2026-08-14-EGRESS-API.md`.
- Continua desconhecida a regra que bloqueia especificamente o IP
  `192.168.208.4` na `ia-local-net`: containers novos no mesmo bridge, e os
  vizinhos `portal-app` (.8) e `n8nprod-n8n` (.5), saem normalmente. `sudo` no
  servidor pede senha, entao `iptables` nao foi lido. O `gw_priority` contorna
  o caminho, nao remove a regra.
- O health check atual da API cobre banco e Redis, mas nao prova disponibilidade
  do login Google ou de integracoes externas. Usar alerta/probe sintetico
  separado para egress; nao transformar dependencia externa em readiness que
  reinicia a API inutilmente.
- SHA `3f36137a697fee9f4f1011bc3eace3417467d5be` foi implantado com sucesso
  operacional em 2026-06-19: backup, migrations, API/web/cert-api healthy,
  observabilidade iniciada e `REVISION` remoto gravado.
- O bloqueio publico por 502 registrado em junho foi superado: em 2026-08-03,
  `https://importacao.grupounico.com/` e `/api/health` responderam HTTP 200. A
  topologia confirmada continua Nginx/edge externo -> Nginx interno do app em
  `192.168.168.124:8085`; manter `8085:80` no compose.
- Revisao observada em producao durante o incidente de 2026-08-03:
  `b55968a1ded2527524113543cb5febc64c7fedd2`.

Evidencias:

- `scripts/deploy.sh`
- `docker-compose.prod.yml`
- `docs/STATUS-2026-06-16.md`
- `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`
- `docs/INCIDENTE-2026-08-14-EGRESS-API.md`

Grau de confianca: alto.

## Certificacao — Layout E Estoque Validados Em 2026-08-17

- Imaginarium e Puket usam H como tipo, P como numero e V como Descricao
  E-commerce. Puket Escolares usa D como tipo, E como numero, H como status e I
  como Descricao E-commerce; C e apenas categoria ESTOJO/LANCHEIRA.
- A comparacao com a VTEX prioriza a Descricao E-commerce. O relatorio de
  validacao deve serializar esse texto como `expected_cert_text` e manter
  `certification_type` em campo/coluna separado.
- A planilha atual tem 14 SKUs efetivamente sem descricao (6 Imaginarium, 8
  Puket) e nenhum Puket Escolar sem descricao. Ha 15 SKUs duplicados com
  descricoes conflitantes; o sync ainda usa last-write-wins.
- Estoque CD significa `available`, nao quantidade fisica. PI7223Y foi validado
  diretamente com 7 fisicos, 7 reservados, 0 disponiveis no WMS e 28 no ERP
  e-commerce. A UI deve continuar mostrando o detalhe fisico mesmo com total
  disponivel zero.
- WMS e e-commerce ja usam replace transacional por fonte. A divida residual e
  um gate contra snapshot vazio/truncado e um SLA de frescor; o sync permanece
  diario.

Evidencia:

- `docs/STATUS-2026-08-17-CERTIFICACAO-COLUNAS-DESCRICAO-WMS.md`

Grau de confianca: alto; cabecalhos, contagens, ultimo XLSX, Oracle WMS, ERP e
PostgreSQL foram consultados em modo read-only.

## Importacao Follow Up E Extracao Documental — Regras Duraveis De 2026-08-25

- `correction_status` pertence exclusivamente ao workflow interno; valores de
  planilha como `SIM`/`NÃO` devem ficar em evidência de origem
  (`aiExtractedData.sheetDocumentCorrection`) e em `document_corrections`.
- Dados da planilha usam datas pt-BR, números localizados e percentuais. Não
  usar `new Date(string)` nem remover pontuação de forma genérica; percentuais
  precisam ser persistidos como fração.
- `ai_extracted_data` contém projeções de documentos e metadados de planilha.
  Importações parciais devem fazer merge, nunca substituir o JSON inteiro.
- No BL, `PREPAID` e `COLLECT` são condições de pagamento, não moedas. Sempre
  manter `freightValue = null` quando não houver moeda/valor explícitos.
- Parser determinístico de tabela só pode suprimir o Gemini depois de passar um
  gate de qualidade. Linhas de contato/cabeçalho com vários números podem se
  parecer com itens.
- Confiança do modelo/harness não é acurácia contra ground truth. Garantia de
  90% exige corpus rotulado, medição por campo/tipo e aceite humano dos casos
  abaixo do limiar.
- Reconciliações de dados operacionais devem usar transação serializável,
  assertions pré/pós, backup restaurado em banco temporário e trilha em
  `audit_logs`.

Evidência:

- `docs/STATUS-2026-08-25-RECONCILIACAO-PROCESSOS-GEMINI.md`
- `scripts/reconcile-validation-processes-2026-08-25.sql`
- `scripts/normalize-validation-workflow-state-2026-08-25.sql`

Grau de confiança: alto para as regras de contrato e o estado pós-operação;
médio para acurácia documental até existir ground truth rotulado.

## E-mail, Integrações E UX — Regras Duráveis De 2026-08-26

- Configuração salva de SMTP (`smtp_host`, `smtp_port`, `smtp_user`) deve ser a
  mesma configuração usada pelo transporte; senha permanece apenas em env/SOPS.
- Teste de SMTP é handshake/autenticação com `verify()`, nunca mensagem real.
- `smtp_from` aceita exatamente uma mailbox. CR/LF, lista e sintaxe de grupo
  falham fechadas antes do Nodemailer.
- A caixa operacional de registro permanece explicitamente em `Cc` mesmo sendo
  remetente, salvo se já estiver em `To`; header e auditoria devem coincidir.
- Logs não devem conter query string, assunto, remetente, destinatário, corpo ou
  nome original de documento.
- Configuração presente não é evidência de integração rodando. O checkpoint de
  26/08 confirmou apenas Gmail; SMTP/IMAP recusaram autenticação, Drive retornou
  404 e dependências de rede Compose estavam fora do ar.
- Evidência de reprocessamento é por ambiente: em validação, 51 documentos de
  12/117 processos estavam processados em 25/08; isso não prova o estado de
  produção nem cria documentos para os outros 105 processos.
- Smoke visual local usa dados simulados e cobre renderização/responsividade,
  não ações externas ou mutáveis. Baseline de 26/08: 31 variantes de rota,
  cinco abas de Configurações e 13 abas do detalhe sem exceção.
- Acknowledgement de ingestão exige estado terminal durável. Log `processing`
  com lease ativa mantém a mensagem não lida; após
  `EMAIL_PROCESSING_STALE_MINUTES`, outro worker pode reclamar o mesmo log e
  retomar sem criar um segundo registro.
- HTML de comunicação é fronteira não confiável: DOMPurify protege a renderização
  React e `sanitize-html` com allow-list independente protege persistência e
  envio. Não substituir por regex.
- O harness local de e-mail usa GreenMail 2.1.13 + Testcontainers 12.1.0. Ele
  prova SMTP/IMAPS e a API sem egress, mas nunca substitui o probe de credencial
  do provider real.
- O Compose de desenvolvimento aceita integrações Cert-API vazias para permitir
  trabalho independente; `docker-compose.prod.yml` deve permanecer estrito.

Evidência:

- `docs/STATUS-2026-08-26-AUDITORIA-INTEGRACOES-EMAIL-UX.md`
- `docs/SECURITY_AUDIT_2026-08-26.md`

Grau de confiança: alto para código, testes e probes executados; médio para
estado externo até repetir dentro do Compose; não estabelecido para produção.

## Certificados E Propriedades Linx — Regras Duráveis De 2026-08-26

- Número/tipo do certificado vêm da planilha sincronizada em `cert_products`; validade
  e vencimento do licenciamento vêm das propriedades do próprio Linx.
- Códigos: Imaginarium `00106/00107`; Puket e Puket Escolares `00224/00225`.
- `cert_certificates` é trilha das operações feitas pelo formulário, não fonte de
  verdade da trava. Tabela vazia não implica Linx vazio.
- `01/01/1900` é sentinela de ausência e nunca deve virar data vencida na UI.
- Consulta e escrita devem usar a mesma resolução SKU→produto e marca exata
  normalizada. Correspondência por substring pode selecionar a base errada.
- Pré-preenchimento da UI nunca substitui valor já digitado pelo operador.
- Não completar lacunas em massa a partir de inferência: Puket Escolares tinha poucas
  datas efetivas em 26/08 e exige decisão fiscal.

Evidência: `docs/STATUS-2026-08-26-CERTIFICADOS-LINX.md`.

Grau de confiança: alto para conectividade, contratos e contagens observadas; não
estabelecido para a regra de negócio das lacunas sem validação fiscal.

## Dependências E Regressão De Rotas — Baseline De 2026-08-26

- Frontend usa React Router 7.18.2; não reintroduzir os future flags do Router 6.
- `@esbuild-kit/esm-loader` é substituído por `tsx` no override da raiz porque o
  pacote foi descontinuado e mantinha `esbuild` vulnerável. Validar qualquer
  mudança dessa exceção com `npm ci`, audit completo e `drizzle-kit check`.
- `drizzle-orm` permanece dependência de runtime da API e dev dependency da raiz
  para ser resolvido pelo `drizzle-kit` hoisted do workspace.
- A regressão de rotas oficial está em `apps/web/e2e/route-smoke.spec.ts` e deve
  acompanhar toda URL nova em desktop e Pixel 7.

Evidência: `docs/STATUS-2026-08-26-REMEDIACAO-SEM-CREDENCIAIS.md`.

## Riscos Persistentes

Ver detalhes em:

- `docs/KNOWN_ISSUES.md`
- `docs/TECH_DEBT.md`
- `docs/ROADMAP.md`
- `docs/STATUS-2026-06-16.md`
- `docs/UX_UI_AUDIT_2026-06-17.md`

Principais temas:

- Login Google e integracoes externas permanecem sob risco alto enquanto o
  gateway default da API nao for fixado em `importacao_default`.
- Timeouts de Google Groups sao atualmente convertidos em HTTP 401; tratar
  indisponibilidade externa como HTTP 503 com mensagem segura.
- Extração de cabeçalho/portos/datas ainda depende da qualidade do provider.
- Odoo agora aceita URL/database/usuario do banco com fallback para env; senha
  permanece em SOPS/env.
- Fluxos de aceite entre checklist e comparativo ainda podem ser melhor unificados.
- Documentacao de IA possui divergencias historicas entre Vertex ideal e IA local atual.

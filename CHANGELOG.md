# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] - 2026-08-17 - Pedidos da Eduarda na importacao e gate de estoque

Detalhe em `docs/STATUS-2026-08-17-IMPORTACAO-PEDIDOS-EDUARDA.md` e
`docs/STATUS-2026-08-17-CERTIFICACAO-COLUNAS-DESCRICAO-WMS.md`.

### Added

- Allow-list de referencias de processo vindo da coluna A da planilha Follow Up
  (`modules/follow-up/reference-registry.ts`), com cache por TTL, coalescencia
  de chamadas e match exato. `PROCESS_REFERENCE_SOURCE=legacy` restaura o fluxo
  antigo.
- Ingestao de documentos a partir da pasta do processo no Google Drive
  (`modules/documents/drive-ingestion.service.ts`), com dedupe por
  `driveFileId`, cron `*/10` e a chave `DOCUMENT_SOURCE` (`email` | `drive` |
  `both`, padrao `email`).
- `rasterizePdfPages()` em `documents/ocr.ts`: rasteriza PDF escaneado para PNG
  via Poppler quando o provider de IA nao le PDF nativamente.
- `googleDriveService.findProcessFolder()`, que localiza a pasta do processo sem
  criar a arvore como efeito colateral.
- Gate de volume no sync de estoque de certificacao
  (`_assert_snapshot_plausible` em `cert-api/app/services/wms_service.py`).

### Fixed

- Parse da resposta da IA tolera texto em volta do JSON (cerca markdown,
  preambulo, rodape) recortando o payload balanceado, em vez de derrubar a
  extracao inteira e deixar o documento com todos os campos vazios. O erro
  restante passa a distinguir `truncated` de `no_json`.
- Escalonamento para o modelo de upgrade passa a valer tambem para violacao do
  contrato JSON, nao so para confianca baixa. Antes a excecao subia e o
  documento morria sem o modelo melhor ser tentado — a telemetria de producao
  mostrou 10 de 10 extracoes de prompt grande falhando assim.
- Texto de planilha enviado a IA passa a descartar linhas so-separador e a
  respeitar um teto de caracteres. Uma coluna formatada inteira gerava CSV de
  centenas de milhares de linhas de virgulas e estourava o timeout de 180 s —
  3 dos 4 timeouts de producao eram XLSX de 25 a 36 KB.
- Referencia de processo truncada deixa de anexar documento ao processo errado.
  O terceiro estagio do match era `ilike('%CODE%')`, e `PK2052602` casava com
  `PK2052602TJ`.
- PDF escaneado deixa de ser enviado como `data:application/pdf;base64,...` para
  provider que so decodifica imagem (`ialocal`, `openrouter`). Era o que fazia a
  extracao concluir com quase todos os campos vazios e a tela mostrar "-".
- Multimodal passa a aceitar mais de uma imagem
  (`ImageExtractionOpts.additionalImagesBase64`); antes uma invoice de duas
  paginas perdia a tabela de itens.
- Extracao sem OCR e sem rasterizacao possivel falha com motivo explicito em vez
  de gravar documento de campos vazios que se apresenta como lido.
- Snapshot vazio de WMS/ERP deixa de apagar o estoque da fonte e zerar o CD de
  toda a base.

### Changed

- `stalled-process` deixa de emitir um alerta por processo parado a cada
  execucao diaria e passa a emitir por marco de escalada (3, 7, 14, 30, 60
  dias), com `critical` a partir de 30, mais um resumo diario. Era a origem de
  6.152 dos 6.349 alertas da base (97%). O marco e o MAIOR ja alcancado, com
  janela de deduplicacao casada ao espacamento — assim uma execucao perdida do
  cron (dia de deploy recria o container) atrasa o alerta em vez de cancela-lo,
  e um processo que volta a parar torna a alertar.
- `alertService.hasDuplicateRecent` aceita janela configuravel; o padrao segue
  24h para todos os chamadores existentes.
- Falha de entrega de alerta sobe de `warn` para `error` e ganha o contador
  `alert_delivery_total{channel,outcome}`.
- `login_failed` passa a cobrir `network_error`, `invalid_token`,
  `wrong_domain`, `inactive_user` e `unknown_user` — antes so `not_in_group`
  deixava rastro, e o caminho de rede (o do incidente de 12 dias) sumia.
- Upload avisa (sem bloquear) quando o mesmo arquivo ja existe no processo.
- `deploy.sh` arquiva o log dos containers antes de recria-los, retencao 30 dias.
- Novas metricas: `ai_contract_violations_total{context,reason}` e
  `ai_prompt_tokens{context}`.
- Novo `GET /health/integrations` (ADMIN): integracao configurada versus ativa,
  com aviso nominal das inertes. Sempre 200 — nao entra no readiness. Usa
  `googleDriveService.isRootConfigured()` como autoridade em vez de reimplementar
  a checagem.

### Operational notes

- Nenhuma mudanca altera o comportamento no momento do deploy: `DOCUMENT_SOURCE`
  nasce em `email`, e o allow-list degrada para o fluxo antigo enquanto
  `GOOGLE_SHEETS_FOLLOW_UP_ID` nao estiver configurado.
- Ligar de fato depende de configuracao: ID real em
  `GOOGLE_DRIVE_ROOT_FOLDER_ID` (hoje placeholder), ID da planilha Follow Up, e
  as duas pastas/planilha compartilhadas com a SA.
- Diagnostico medido em producao: o "-" relatado vem de 17 documentos em falha
  terminal (invoice 15 de 65, 23%), nao de extracao parcial — nas invoices que
  concluem a cobertura de campos e de 99,7%. Producao roda `AI_PROVIDER=vertex`
  com OCR ligado, portanto a correcao de rasterizacao e latente e nao altera o
  comportamento atual. Registrado em `docs/KNOWN_ISSUES.md`.
- Acesso da Odett verificado: conta ativa, login com sucesso as 12:09:56 e
  16:05:45 BRT de 17/08, egress da API sadio, `sydle_sync` 144/144 com sucesso
  em 24h. Problema transiente, sem correcao a aplicar.
- Revisao adversarial pos-entrega achou 5 defeitos no proprio trabalho — recusa
  silenciosa de e-mail, substring sobrevivendo na indisponibilidade, espelho
  reimportado, varredura sem trava de reentrancia e typecheck quebrado por
  teste. Todos corrigidos com teste. Detalhe no STATUS.
- Analise de gaps do sistema em `docs/GAPS-2026-08-17.md`, medida em producao.
  O achado principal corrige o `KNOWN_ISSUES`: o canal de alerta tem 6.349
  registros e **zero** entregues ao Chat, e o alerta de falha do `sydle-sync`
  EXISTIU durante o incidente de 12 dias (18 registros, um por dia). A deteccao
  funcionava; a entrega nunca funcionou.
- Varredura de dados em producao: 133 documentos, 17 em falha terminal, 14
  grupos de duplicata, 28 processos com codigo fora do formato Uni.co (dos
  quais 8 auto-criados por e-mail com referencia truncada, um deles um codigo
  de ITEM e outro `teste123`). Zero lease presa, zero FK orfa, zero codigo de
  processo duplicado.
- Nenhum documento foi reprocessado de proposito: as correcoes nao estao
  publicadas, entao reprocessar agora rodaria o codigo antigo e so gastaria
  orcamento de IA. Ordem correta registrada no STATUS.
- Suites: api 961, web 128, cert-api 509. `tsc` e `eslint --max-warnings=0`
  limpos; `ruff check` limpo; `bash -n scripts/deploy.sh` OK; build OK.

---

## [Unreleased] - 2026-08-17 - Limpeza historica e replay documental controlado

### Added

- Executor de limpeza com dry-run padrao, gates de contagem, verificacao de
  backup, transacao serializavel, preservacao explicita do DEMO e reconciliacao
  de relacionamentos.
- Replay documental por janela de ETD, incluindo processos sem ETD, exclusao
  segura de espelho PDF, espera por estado terminal por processo e retomada por
  evidencia JSONL.
- Override operacional para pausar Drive/Chat e ampliar temporariamente a lease
  durante replay controlado.

### Operational notes

- Backup e restore test passaram antes da exclusao. Foram removidos 170
  processos anteriores a 2025-05-01; restaram 104 e o DEMO 264 permaneceu com
  11 documentos.
- O snapshot de 37 documentos terminou com 32 sucessos e 5 invoices em
  quarentena. Tres uploads concorrentes elevaram o estado final a 40
  documentos, 34 sucessos e 6 falhas terminais.
- Os 19 processos foram reconciliados e revalidados; fila e leases fecharam em
  zero e a configuracao normal da API foi restaurada.
- Evidencias completas em
  `docs/STATUS-2026-08-17-LIMPEZA-REPROCESSAMENTO.md`.

## [Unreleased] - 2026-08-17 - Certificacao: layout escolar, relatorio e estoque

### Fixed

- Puket Escolares passa a ler o tipo de certificacao da nova coluna D, sem
  confundir a categoria de produto da coluna C; os fallbacks de numero, status
  e Descricao E-commerce acompanham o layout E/H/I.
- O relatorio de validacao mostra separadamente o tipo de certificacao e a
  Descricao E-commerce realmente usada como Texto Esperado.
- Painel e XLSX deixam claro que o total do CD e estoque disponivel. Um item com
  estoque fisico totalmente reservado continua expondo o detalhe, mesmo quando
  o disponivel e zero.

### Operational notes

- PI7223Y foi conferido diretamente: WMS com 7 fisicos/7 reservados/0
  disponiveis e ERP e-commerce com 28. O resultado 0 + 28 esta correto.
- A planilha atual tem 14 SKUs efetivamente sem Descricao E-commerce; os 41 eram
  a fotografia de 07/08. Detalhes em
  `docs/STATUS-2026-08-17-CERTIFICACAO-COLUNAS-DESCRICAO-WMS.md`.

## [Unreleased] - 2026-08-14 - Egress da API restaurado e erro de login honesto

### Fixed

- A API voltou a ter saída para a internet. A rota default do container caía na
  rede `ia-local-net`, por onde o tráfego externo morria; `gw_priority` no
  `docker-compose.prod.yml` fixa a saída na rede do próprio stack, mantendo
  `ia-local-net` conectada para o gateway de IA local. Sem isso a falha
  reincidia a cada recriação do container.
- Queda de dependência externa deixou de ser apresentada como "sua sessão
  expirou". O `authController` parou de achatar toda exceção em HTTP 401:
  falha de infraestrutura responde 503, fora do grupo e conta desativada
  respondem 403, e 401 fica só para credencial inválida de verdade.
- O `api-client` não redireciona mais para `/login?expired=1` quando o 401 vem
  dos próprios endpoints que emitem a sessão (`/api/auth/login`,
  `/api/auth/google`). A mensagem real passa a aparecer na tela de login, em
  vez de a página recarregar antes de exibi-la.
- `verifyIdToken` também busca chaves pela rede; falha de rede ali deixou de ser
  reportada como token inválido.

### Added

- `isNetworkError()` em `shared/utils/resilience.ts`, que distingue "o outro
  lado respondeu que não" de "não consegui falar com o outro lado", incluindo o
  formato do Gaxios.
- Cache curto (10 min) da checagem de pertencimento ao Google Group, com
  sobrevida de 12 h usada apenas quando o Google está inacessível. Negativas não
  entram no cache: incluir alguém no grupo continua valendo na hora e quem sai
  perde a sobrevida junto.

### Operational notes

- Incidente contínuo de 2026-08-01 17:38 UTC (reboot do host) a 2026-08-14
  16:20 UTC: 1.864 execuções consecutivas do `sydle-sync` falharam sem um único
  sucesso, com `/health/ready` verde o tempo todo. Linha do tempo completa,
  evidências e pendências em `docs/INCIDENTE-2026-08-14-EGRESS-API.md`.
- A regra que bloqueia especificamente o IP `192.168.208.4` na `ia-local-net`
  continua desconhecida e ativa; o `gw_priority` contorna o caminho, não remove
  a causa. Registrado em `docs/KNOWN_ISSUES.md`.
- Continua sem alerta de egress e sem alerta de cron falhando em sequência. O
  detector deste incidente foi a usuária final, após 13 dias.

---

## [Unreleased] - 2026-07-10 - Fechamento de revisão operacional Odett

### Fixed

- Um atendimento cujo envio falhou pode ser corrigido e reenviado: ao editar,
  ele volta para `draft`, limpa o erro anterior e preserva a trilha de auditoria.
- Follow-Up passa a mostrar as 15 etapas persistidas e seu progresso usa a
  proporção real das etapas concluídas, chegando a 100%.
- Follow-Up, Registro/DUIMP, Etapas específicas e Erros/Custos exibem estado
  de erro com nova tentativa, em vez de aparentarem estar vazios.
- O badge `PI`/`INV` também aparece na visão unificada do relatório SYDLE
  quando a coluna Processo usa o fallback do número de documento.

### Operational notes

- Produção publicada e validada em 2026-07-10: migration 0024, OCR local,
  mailbox `global@grupounico.com`, ressync completo SYDLE e reprocessamento do
  PK2052602TJ. Invoices sem extração útil permanecem em revisão manual.
- A sincronização Follow-Up ↔ planilha ainda é manual e administrativa; não
  foi ativada uma sobrescrita automática sem confirmação da planilha-fonte,
  frequência e política de conflito.
- O ambiente de produção deve configurar `GMAIL_SHARED_MAILBOX` como
  `global@grupounico.com` para que a ingestão use a caixa solicitada.

---

## [Unreleased] - 2026-07-10 - Recuperação e auditabilidade documental

### Added

- Documento já ingerido pode ser reclassificado e reextraído por operador sem
  reupload: a extração anterior fica no histórico, projeções/aceites derivados
  são reconstruídos e a ação entra na auditoria/timeline.

### Changed

- A origem de anexos passa a consultar a linhagem relacional documento↔e-mail,
  eliminando inferência frágil por nome de arquivo e janela de logs.

### Fixed

- Analistas passam a ter acesso na UI ao reprocessamento e à correção de tipo,
  que a API já suportava como ações não destrutivas.

---

## [Unreleased] - 2026-07-09 - Relatório SYDLE: pagamento por conclusão do ticket

### Fixed

- "Pago Em" deixou de exibir a data de finalização do ticket. A parcela
  sincronizada da SYDLE não traz data nem flag de pagamento (esses campos
  financeiros seguem atrás das classes em 403), então `paidAt` fica em branco
  até a SYDLE expô-la, em vez de mostrar a finalização (que é outra coisa).
- Tickets concluídos deixam de aparecer como vencidos. Pela regra da operação
  (o ticket só finaliza quando todas as parcelas são pagas), um ticket com
  status "Concluído" marca as parcelas como `paid` (valor pago cheio, saldo 0),
  sem usar a data de finalização como data de pagamento. Ticket "Em andamento"
  segue com a parcela `open`/vencida quando aplicável.
- Detecção de conclusão pelo nome do status do ticket (não pela mera presença
  de data de conclusão, que também ocorre em cancelamento).
- Base de produção reprocessada com full resync (26 linhas re-derivadas).

---

## [Unreleased] - 2026-07-09 - Revisão profunda pós-entrega (correções)

### Fixed

- Edição de processo com Data de Registro/Desembaraço preenchidas não quebra
  mais (strings agora convertidas para Date com validação; inválida → 400).
- Valores decimais com vírgula (pt-BR) são normalizados para ponto antes do
  Postgres em todos os campos numéricos de processo e Erros/Custos; limites
  máximos derivados da precisão das colunas (dólar de registro, valor
  aduaneiro, seguro, valor de custo extra).
- Campo destinatário de atendimento alinhado à coluna (máx. 255 caracteres).
- Editar valores no Comparativo geral agora recalcula o status da linha
  (corrigir uma célula divergente reconcilia de verdade) e limpar uma célula
  editada exibe vazio em vez de voltar ao valor extraído.
- Badge `PI`/`INV` do relatório SYDLE aparece apenas quando a coluna Processo
  usa o fallback (sem código de processo real).
- Status de pagamento explícito vindo do SYDLE ('Pago', 'Em aberto'…) é
  normalizado para o enum antes de chegar à UI.
- Conferência de fabricantes compara todos os pares (divergência entre dois
  fornecedores não-primeiros não passa mais despercebida).
- Aba Comparativo recuperou os atalhos manuais `Revalidar` e `Gerar e-mail de
correção` (compactos — o editor completo continua em Atendimentos).
- `isConfigured`/`testConnection` do Gmail passaram a usar o mesmo fallback de
  mailbox compartilhado do fetch, e o job registra aviso ao usar o padrão.
- Recriar modelo de atendimento com nome de modelo desativado reativa o
  registro; nome de modelo ativo duplicado retorna 409 claro.
- Etapas específicas validam `completedAt` (data inválida → 400 claro).
- Configuração: `default_cc_email` semeado em produção (cópia fixa
  `global@grupounico.com`); `EMAIL_BODY_MAX_CHARS` documentado no
  `.env.example` e no schema de env.
- Testes novos: check `ncm-bl-description` (7 casos) e normalização decimal do
  schema de processos.

---

## [Unreleased] - 2026-07-09 - Feedback Odett: atendimentos, comparativo, DUIMP e SYDLE

### Added

- Atendimentos por e-mail agora permitem buscar processo por campo editável,
  anexar documentos do processo, reabrir/editar rascunhos e atualizar antes do
  envio tanto no menu quanto dentro do processo.
- Modelos de atendimento podem ser criados, editados e desativados em
  Configurações > Modelos por usuários autenticados, e reutilizados no menu
  Atendimentos e na aba Atendimentos do processo.
- Ingestão de e-mails passa a persistir `body_text`; a aba `E-mails` do processo
  permite expandir e consultar o corpo das novas mensagens ingeridas.
- Configuração de cópia fixa de e-mail (`COMMUNICATION_DEFAULT_CC` /
  `default_cc_email`) e envio SMTP com `cc` operacional.
- Tipos documentais `draft_duimp` e `duimp`, upload manual, classificação por
  nome/texto/IA e campos de registro aduaneiro no processo: valor aduaneiro,
  dólar de registro, seguro, DUIMP, data de registro, desembaraço e canal RFB.
- Aba Registro com conferência processo x Draft DUIMP/DUIMP Final por aliases
  extraídos, usando a DUIMP final como fonte preferencial quando existir.
- Campo vermelho de observação urgente no topo fixo do detalhe do processo.
- Abas `Etapas` e `Erros/Custos` dentro do processo, com APIs auditadas para
  etapas específicas, erros documentais e custos extras.
- Comparativo geral editável por coluna, com persistência em
  `comparison_field_overrides`, evento do processo e mensagem `Editado por`.
- Comparativo de itens passou a exibir fabricante e proporção peso bruto/líquido;
  um quadro dedicado compara fabricantes INV/PL/Espelho.
- Extração de Invoice aceita `manufacturerAliases` para conferir apelidos de
  rodapé contra fornecedores do Espelho quando o documento trouxer essa lista.
- Relatório SYDLE ganhou fallback da coluna `Processo` para `Número Invoice`
  quando o processo não existe no formulário e badge visual `PI`/`INV`.

### Fixed

- Módulo de Certificações liberado com menor privilégio para usuários `analyst`:
  o gate `/api/auth/cert-api-access` (usado pelo nginx para `/cert-api/*`)
  agora permite consulta, validação e exportação. Sincronizações, agendamentos,
  cadastro/reenvio ao Linx e configurações continuam restritos a `admin`,
  inclusive por URL direta.

### Changed

- Aba Comparativo remove o bloco grande de checklist e concentra a operação no
  comparativo consolidado; checks de fabricante, endereço fornecedor, pagamento,
  certificado, proporção de peso e matching genérico de itens deixam de poluir o
  quadro geral.
- Matching de itens INV/PL/Espelho usa código canônico extraído também de
  descrições com coleção/cor coladas.
- Check `ncm-bl-description` passa a validar prefixos NCM de 4 dígitos do OHBL
  final contra as NCMs do Espelho, em vez de procurar NCM em texto livre do BL.
- Edição de processo não envia campos opcionais vazios e aceita dólar de
  registro com até 6 casas decimais.
- Fase logística `registered` também considera DUIMP/data de registro.
- Gmail usa `global@grupounico.com` como mailbox compartilhado padrão quando
  `GMAIL_SHARED_MAILBOX` não estiver definido.
- Usuários autenticados, não apenas administradores, podem gerenciar modelos de
  atendimento e assinaturas; configurações técnicas continuam restritas a admin.
- SYDLE One deixa de usar conclusão do ticket como pagamento da parcela; `paidAt`,
  valor pago, saldo e status passam a vir do próprio `paymentData`.

### Fixed

- Rascunhos de atendimento ficaram validáveis/editáveis antes do envio.
- Aba de e-mails recebidos deixou de mostrar só título/anexos para mensagens
  novas com corpo persistido.
- Linhas PI sem processo não ficam mais com a coluna `Processo` vazia no relatório
  e exportações SYDLE.
- Parcelas já pagas deixam de aparecer vencidas/abertas quando o ticket ainda não
  foi finalizado, desde que a SYDLE envie data/status de pagamento na parcela.

## [Unreleased] - 2026-07-08 - Paridade do relatório SYDLE Analytics

### Added

- Staging SYDLE ganhou colunas aditivas do relatório consolidado/CSV:
  protocolo, emissão Invoice/PI, criação da tarefa, exceção, motivo da exceção,
  embarque e prazo de pagamento pós-embarque.
- Endpoint administrativo `POST /api/sydle/sync-now?full=1` para full resync
  auditável quando o mapeamento SYDLE muda e registros antigos precisam ser
  reprocessados pela API real.
- Exportações CSV/XLSX do relatório SYDLE passam a incluir as colunas do
  relatório Analytics junto dos campos operacionais do portal.
- Tela SYDLE ganhou uma visão unificada abaixo da visão operacional, com as
  mesmas colunas e ordem do Excel/CSV.
- Leitura do módulo SYDLE liberada para todos os usuários autenticados com
  acesso ao módulo de importação; sincronização manual, configuração e histórico
  de sync permanecem restritos a admin.

### Changed

- Normalizador SYDLE reconhece aliases do CSV `Relatório Sydle.csv`, trata
  `(vazio)` como nulo e deriva chave estável por protocolo + invoice +
  vencimento + valor + prazo pós-embarque quando a fonte não fornece ID único.
- Normalizador/conector SYDLE One reconhece aliases reais do payload
  `requestData.emissionDate`, `requestData.endDateForm` e
  `requestData.departureDate` para emissão Invoice/PI, criação da tarefa e
  embarque.
- Tipo de pagamento da SYDLE One passa a preservar os três valores do relatório
  (`Deposit in Advance`, `Balance before Shipment`, `Balance after Shipment`)
  em vez de reduzir tudo para depósito/saldo genérico.
- Sync automático SYDLE passa de 15 para 10 minutos.
- Relatório SYDLE deixa de preencher câmbio/BRL com estimativas do portal; os
  cards, tabelas e detalhe passam a exibir valores financeiros apenas quando a
  própria SYDLE fornece os campos.
- Relatório SYDLE ajustado com feedback operacional: cards financeiros exibem
  valores completos, datas usam `dd/mm/aaaa hh:mm`, CSV/PDF exportam valores e
  status formatados, XLSX usa células nativas de data/moeda, a visão unificada
  remove as colunas duplicadas `Código do processo`/`Compra` e troca
  `Match Portal`/`Motivo Match` por `Conciliação Portal` e `Evidência conciliação`.

## [Unreleased] - 2026-06-29 - Feedback Odett/Eduarda: espelho, Draft BL e configuracoes

### Added

- Checklist do Draft BL ganhou aceite explicito de "Draft Recebido".
- Aba Draft BL ganhou acao de reprocessamento do documento atual, usando o endpoint auditado
  existente de reprocesso.
- Configuracoes passaram a abrir em aba "E-mails", com "Destinatarios operacionais" no topo para
  reduzir erro operacional de allowlist.

### Fixed

- Parser deterministico de espelho XLSX agora reconhece aliases ingleses de SKU/codigo
  (`Code`, `SKU`, `Item Code`, `Product Code`) e pesos (`Net Weight`, `N.W.`, `Gross Weight`,
  `G.W.`, `GW/NW`), cobrindo planilhas que antes marcavam leitura 100% mas deixavam pesos vazios.

## [Unreleased] - 2026-06-25 - Otimizacao de custo IA/Vertex

### Added

- Preflight de custo projetado por chamada no `aiService.chat()`, estimando tokens de entrada/saida
  antes de chamar provider pago.
- Caps configuraveis de `maxOutputTokens` por contexto (`AI_EXTRACTION_TABLE_MAX_OUTPUT_TOKENS`,
  `AI_BL_MAX_OUTPUT_TOKENS`, `AI_ANALYSIS_*`, `AI_SELF_REPAIR_MAX_OUTPUT_TOKENS`, etc.).
- Teste de regressao para o teto diario: chamada e bloqueada quando `gasto atual + estimativa`
  ultrapassa `AI_DAILY_BUDGET_BRL`.

### Changed

- Bloqueio mensal/diario de IA agora considera custo projetado da proxima chamada, nao apenas
  gasto ja registrado. Isso evita passar do teto de R$100/dia por uma chamada grande.
- Self-repair continua habilitado no IA_LOCAL, mas em provider pago (`vertex`/`openrouter`) fica
  desligado por padrao; para autorizar a chamada extra, usar `AI_SELF_REPAIR_PAID=1`.
- Variaveis de custo, caps, upgrade e self-repair passaram a ser validadas no schema de ambiente.

### Fixed

- Login Google de usuarios `analyst` deixava o portal abrir e voltar ao login: o portal chamava
  `/cert-api/api/stats` mesmo para nao-admin, o proxy da cert-api exigia admin e mascarava `403`
  como `401`; o cliente apagava o JWT. Portal agora nao chama cert-api para analistas e o nginx
  preserva `403 Forbidden`.

## [Unreleased] - 2026-06-24 - Revisao profunda de documentos, IA, e-mails e insights

### Added

- Parser deterministico/testes para BL (`bl-text-parser`) cobrindo campos criticos como
  BL, referencia, portos, navio, viagem, container, pesos, free time e NCM.
- Painel de diagnostico de extracao no comparativo documental, usando
  `extractionCoverage` ja retornado pela API.
- Metadados recuperaveis no JSON de anexos de e-mail: hash SHA-256, origem da mensagem,
  indice do anexo, caminho local, Drive inbox e flag de orfao.
- Migration `0020_document_lineage_and_email_dedupe.sql` com:
  `email_attachment_documents`, `document_extraction_runs`,
  `document_extracted_fields` e `comparison_acceptances`.
- Linhagem relacional por campo para novas extrações documentais.
- Deduplicacao forte de anexo por `process_id + content_sha256` antes de criar novo documento.
- Aceite relacional de comparativo com hash de evidencia e invalidação por reprocessamento.
- Classificacao textual de anexos genericos por conteudo PDF/XLSX antes de cair em `other`.

### Changed

- Cobertura ponderada de extracao passa a contar campos obrigatorios ausentes do JSON,
  nao apenas campos que a IA retornou.
- Draft BL passa a usar upgrade por baixa confianca e self-repair, alinhado ao BL final.
- Ingestao Gmail/IMAP deixou de marcar mensagens como lidas durante o fetch; agora marca
  somente apos log terminal persistido.
- Varreduras manuais/historicas/double-check de Gmail permanecem fail-closed em
  `EMAIL_ALLOWED_SENDERS`.
- Reprocessamento de documentos invalida aceites ativos do comparativo.

### Fixed

- Corrigido `[object Object]` na aba Documentos/Dados Consolidados.
- Cards de processo, Draft BL e resumo de IA agora desembrulham `{ value, confidence }`
  legado e renderizam resumo humano para objetos.
- Corrigido regex/captura de `vesselName` no parser de BL.

## [Unreleased] - 2026-06-22 - Vertex ligado + fixes (login, licenciamento, custo)

Deployado em prod (`e170b43`). Doc: `docs/STATUS-2026-06-22.md`.

### Added

- **Vertex AI em producao** (`AI_PROVIDER=vertex`, #60 resolvida) com tetos de custo:
  diario R$100 (`AI_DAILY_BUDGET_BRL`), mensal R$1.000, e cap por pergunta no assistente
  (`ASSISTANT_MAX_OUTPUT_TOKENS=768`).
- Eduarda #1 (auto "em transito" ao extrair BL / editar ETD) e #3b (`fillPackingListNullsFromText`).

### Fixed

- **`ai/providers/vertex.ts`**: `toVertexSchema()` converte o JSON Schema para o subset
  do Vertex (`type` array nullable + remove `$schema/additionalProperties/...`) — corrige
  HTTP 400 em TODA extracao com structured output. Removido `gemini-2.0-flash` do fallback (404).
- **`web/nginx.conf`**: `/api` via upstream em variavel + resolver — corrige 502 no login
  quando a API e recriada (IP novo) sem recriar o web.
- **cert-api**: aba "Licenciamentos Vencidos" passa a reconhecer a coluna "Produto"
  (Status Licenciamento #10; 1845 linhas; antes "--").

### Notes

- Teto de extracao e DADO, nao IA: docs ruins (xlsx-como-invoice, screenshots,
  misclassificados, scans grandes) ficam em 0 com qualquer modelo. Ver STATUS §3-4.
- Pendente (dado/config, nao codigo): higienizar documentos, destinatarios #78, coluna de
  data na aba de licenciamentos #11, acesso Sydle #3a, key do webhook Google Chat.

---

## [Unreleased] - 2026-06-21 - Feedback Eduarda: finalizacao + verificacao adversarial (PR #99)

Auditoria multi-agente (18 itens do feedback: audit + verificacao adversarial)
contra o codigo ja em producao. Maioria ja estava em `master`; deploy de `fa75ffe`
ja havia ocorrido. Verificadores derrubaram 4 "done" para defeitos reais — corrigidos.
Doc canonico: `docs/STATUS-2026-06-21.md`. Prod `fa75ffe` -> `df13229`.

### Added

- `fillProformaNullsFromText` (`ai/utils/proforma-text-parser.ts`): preenche
  escalares (piNumber/totalFobValue/currency/...) no caminho do LLM a partir do
  parse deterministico — proforma com PI+FOB mas SEM itens NCM nao perde mais os dados.
- `containerType` no schema + prompt do **Draft BL** (`draft-bl-response.ts`,
  `prompts/draft-bl.ts`) — antes so o BL Final/OHBL extraia; processos so com Draft
  BL ficavam sem "Container".
- `dateOpts` por linha em `computeRowStatus` (`documents/service.ts`) — tolerancia
  de data configuravel por linha do comparativo.
- Teste de regressao `processes/__tests__/logistic-auto-advance.test.ts` (transicao
  automatica para "em transito" quando o ETD/embarque esta no passado).

### Fixed

- **Comparativo "ETD / Shipped On Board"** voltou a considerar as datas de emissao
  da Invoice e do Packing List como fallback (removidas em `fdd17d9`), com
  **tolerancia ampla** (match <=45d, warning <=90d): divergente so se MUITO
  divergente (pedido da Eduarda — "nao precisam ser iguais").
- Draft BL preenche "Container" em Informacoes do Processo (via `containerType`).
- Proforma sem linhas NCM nao perde mais PI/FOB no caminho do modelo.

### Notes

- Itens externos pendentes: Vertex IAM 403 (#60) e destinatarios operacionais (#78).
- Backlog: `fillPackingListNullsFromText` simetrico; coluna "Sistema" no comparativo
  POR ITEM (exige validacao de sistema em nivel de item no backend).

---

## [Unreleased] - 2026-06-20 - Extracao 1000% + relatorio Sydle + review enterprise

### Added

- `apps/api/src/modules/ai/utils/numbers.ts`: parser decimal unico (`parseDecimal`)
  compartilhado pelos 4 parsers deterministicos (invoice/PL/LI/proforma).
- Extracao deterministica de `paymentTerms` (deposit/balance/%) na invoice.
- Relatorio Sydle: coluna/filtro de **Fase do processo** (logisticStatus), filtro
  de **moeda** e atalhos de **vencimento** (vencidos / 7d / 30d); coluna Fase no CSV.
- Relatorio Sydle: **abrir a compra** — clique na linha/card abre um drawer com
  TODOS os detalhes (compra, pagamento, cambio/banco, conciliacao, auditoria e o
  **payload bruto da SYDLE**). Endpoint `GET /api/sydle/payments-report/:id`.
- Relatorio Sydle: seletor de visão **Tabela/Cards** e exportação com filtros
  ativos em **CSV, Excel (.xlsx) e PDF**.
- Indice `import_processes_logistic_status_idx` (migration `0019`) para o filtro de fase.
- `docs/ENTERPRISE-REVIEW-2026-06-20.md` com o review do time de 10 papeis e P0/P1.

### Fixed

- **Seguranca (P0 ainda aberto):** tentativa de mover credenciais SYDLE do
  `signIn` para POST body falhou em producao (`HTTP 405`); o client voltou ao
  GET funcional exigido pela SYDLE One. Mitigacao depende de token/header/POST
  no fornecedor, scrub/restricao de logs e rotacao de `SYDLE_PASSWORD`.
- `parseNumber`: numeros com multiplos separadores de milhar (`1.234.567`) viravam
  `NaN`/`null` (perda de dado); agora lidos corretamente.
- `flattenAiData` agora desempacota `{value,confidence}` aninhados (paymentTerms,
  arrays) → fim de cruzamentos nulos por objetos crus.
- EAN validado por check digit GS1 (`normalizeGtin`) nos parsers — sem EAN invalido.
- Packing List: peso liquido/bruto por item corrige inversao (net <= gross).
- Certificacao "Verificar" deixou de engolir erros (toast).
- `DocumentComparison`: guardas `?? []` evitam tela branca em resposta parcial.
- Sydle: upsert `onConflictDoUpdate` (idempotencia) + `currencyBreakdown` (multi-moeda).

---

## [Unreleased] - 2026-06-17 - Harness operacional e validacao documental

### Added

- `AGENTS.md` com regras permanentes para agentes: contexto obrigatorio, workflow,
  seguranca, qualidade, git/deploy e formato de auditoria ampla.
- `docs/HARNESS_PROMPT.md` com prompt mestre portavel para Codex/Qwen/Llama.
- Memorias operacionais em `docs/PROJECT_MEMORY.md` e `docs/SESSION_MEMORY.md`.
- Backlogs vivos em `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md` e `docs/ROADMAP.md`.
- Documentacao de referencia: `ARCHITECTURE`, `BUSINESS_RULES`, `DATABASE`,
  `API`, `SECURITY`, `DEPLOY`, `OBSERVABILITY` e `PERFORMANCE`.
- `docs/ADR/README.md` como compatibilidade para referencias a `docs/ADR/`,
  mantendo `docs/adr/` como diretorio canonico.
- Assistente operacional RAG em `/importacao/assistente`, com rota
  autenticada `POST /api/assistant/query`, fontes internas e fallback
  deterministico.
- Balao flutuante do Assistente IA nos layouts de Importacao e Certificacoes,
  reutilizando `POST /api/assistant/query` sem interromper formularios ou
  navegacao.
- Modulo SYDLE de Compras e Pagamentos Internacionais com tabelas
  `sydle_purchase_payments`/`sydle_sync_runs`, API `/api/sydle`,
  tela `/importacao/compras-pagamentos`, exportacao CSV backend e sync
  agendado a cada 15 minutos com no-op seguro quando desconfigurado.
- Modo real Sydle One para SYDLE (`SYDLE_SOURCE_TYPE=sydle_one_class`) com
  login por sessao, `POST _classId/_search`, classe internacional validada e
  achatamento de `paymentData[]` em linhas financeiras.
- `document-set-completeness` como check sistemico de validacao, bloqueando
  validacao final quando Invoice, Packing List e BL utilizaveis nao existem.
- Migration `0018_validation_run_links.sql` ligando resultados atuais/historicos
  a `validation_runs` e preservando historico de extracao apos delete de
  documento.
- Endpoint `GET /api/documents/process/:processId/extraction-history` para
  recuperar historico de extracao mesmo apos delete do documento.
- Exportacao CSV para Central de Alertas e Atendimentos usando os filtros
  ativos da tela.
- Utilitario compartilhado `apps/web/src/shared/lib/csv.ts`.

### Fixed

- Acao "Enviar para Fenícia" do espelho agora cria a comunicacao, envia SMTP real com allowlist/anexos auditaveis e so marca o espelho/processo apos sucesso.
- Inicializacao da API passa a conectar o cache Redis em runtime fora de testes e encerra Redis junto da fila no shutdown.
- Checklist de validacao diferencia falhas abertas de aceites manuais.
- Geracao de email de correcao depende apenas de falhas abertas.
- FOB reconhece FOC/desconto por campos alternativos, flag explicita, preco zero
  e desconto negativo.
- Normalizacao de portos cobre acento, pais/sigla, parenteses e evita prefixo inseguro.
- Revisao UX/UI remove busca global falsa dos sidebars e inclui `Meu Dia` na navegacao.
- Titulos e breadcrumbs do detalhe/edicao de processo foram alinhados.
- Skip link global passou a ter alvo real em Login, Portal, Importacao e Certificacoes.
- Lista de processos, filtros de data, abas do detalhe, lista de documentos e botoes de layout ganharam melhorias de acessibilidade.
- Detalhe de processo evita refetch duplicado de e-mails e cambios quando os dados ja foram carregados para indicadores.
- Card de Informacoes do Processo deixou de repetir bloco bruto de dados extraidos ja disponivel na aba Documentos.
- Nomenclatura revisada em telas centrais de importacao: Atendimentos,
  Central de Alertas, auditoria, validacao, LIs, cambios, e-mails, documentos,
  follow-up e dashboards.
- Assistente operacional deixa de retornar dados recentes quando nao ha fonte
  com evidencia positiva para a pergunta.
- Aba de e-mails do processo passou a usar filtro backend por processo, evitando
  contador e historico parciais.
- Exportacao CSV de Alertas e Atendimentos passou a buscar todas as paginas dos
  filtros ativos antes de gerar o relatorio.
- Editor do e-mail de correcao usa o corpo atual digitado mesmo quando o usuario
  salva ou envia sem sair do campo.
- Busca manual de e-mails fica visivel apenas para administradores, alinhada a
  permissao da API.
- Deploy passa a validar o compose remoto antes de migrations/restart, abortar
  se migrations falharem e usar healthchecks com readiness real de API/cert-api.
- Backup inclui o volume `cert-certs` com PDFs/evidencias de certificacao.
- Incoterm e moeda da invoice aceitam variantes comerciais comuns sem gerar falso positivo.
- `dates-match` deixou de tratar `invoiceDate` como data de ETD/embarque.
- Delete e reprocessamento de documento agora recalculam `aiExtractedData`
  consolidado do processo para evitar dados obsoletos.
- Extração de documentos agora usa fila durável `ai-extraction`, captura falhas
  de leitura/parsing antes da IA, classifica documentos presos como `failed`
  apos timeout operacional e bloqueia reprocessamento concorrente.
- Lista de documentos ganhou timeout/estado de carregamento para abrir/baixar
  PDF, evitando acao visualmente infinita em arquivo lento ou indisponivel.
- Comparativo de documentos passou a preferir o documento mais recente,
  processado e sem falha por tipo, evitando usar invoice pendente/obsoleta.
- Documentos processados sem nenhum dado útil extraído agora são tratados como
  falha operacional: não projetam dados no processo, não entram no Comparativo,
  não alimentam validação/anomalias e novas extrações vazias viram
  `extractionFailed` com alerta para reprocessar/reclassificar.
- Inicializacao da fila `pg-boss` agora cria idempotentemente as filas
  `email-send`, `drive-sync`, `sheets-sync` e `ai-extraction` antes de enviar
  jobs, evitando uploads/reprocessamentos presos como pendentes.
- Parser deterministico de Invoice cobre o layout compacto da KIOM gerado por
  PDF com colunas coladas, incluindo `CI NUMBER`, `CI DATE`, portos,
  `INCOTERMFOB`, `TOTAL FOBUSD...`, itens sem NCM e linha FREE OF CHARGE.
- Calculo de confianca da IA deixou de penalizar campos declaradamente ausentes
  (`value: null`), evitando bloquear extracoes deterministicas corretas por
  campos opcionais vazios.
- Compose/env de producao passam a exigir `GOOGLE_CLIENT_ID` e
  `VITE_GOOGLE_CLIENT_ID`; destinatarios KIOM/Fenicia/ISA agora sao
  configuraveis em `Configuracoes > Destinatarios operacionais`, com env apenas
  como fallback opcional.
- Reprocessamento de documentos agora retorna o mesmo DTO operacional da lista,
  incluindo `aiProcessingStatus`, evitando contrato divergente entre API e UI.
- Enfileiramento de `ai-extraction` agora cai para processamento in-process
  quando o `pg-boss` nao devolve ID de job, evitando documentos presos ate o
  timeout operacional.
- Extração IA de documentos ganhou timeout global configuravel por
  `DOCUMENT_AI_EXTRACTION_TIMEOUT_MS` (padrao 180s), marcando falha explicita
  quando OCR/IA fica pendurado e evitando spinner indefinido.
- Google Drive passou a diferenciar credenciais configuradas de pasta raiz
  configurada: `GOOGLE_DRIVE_ROOT_FOLDER_ID=your-root-folder-id` e tratado como
  desconfigurado, pulando upload/movimentacao automáticos sem erro em cascata.
- Comparativo documental agora exibe aviso de comparativo parcial quando
  Invoice, Packing List, BL ou Espelho estao ausentes ou sem extracao valida;
  indicadores do processo deixam de contar falha tecnica como documento
  extraido.
- Chaves privadas Google vindas do SOPS agora são normalizadas mesmo quando
  chegam com `\n` duplamente escapado, evitando falha `ERR_OSSL_UNSUPPORTED`
  no Gmail/Drive/Sheets/Groups/Vertex.
- Validacao e deteccao de anomalias agora usam `draft_bl` como fallback parcial
  quando `ohbl` ainda nao existe, mantendo OHBL como fonte preferencial.
- Validacao final persiste `validation_runs`, snapshots/live results e
  `document_corrections` na mesma transacao, evitando runs orfaos e perda de
  correcao em falha intermediaria.
- Marco `documents_received` passou a aceitar Draft BL como BL operacional,
  alinhando upload, follow-up e validacao final.
- Suite Vitest da API deixou de paralelizar arquivos para evitar vazamento de
  `process.env` entre testes de IA e chamadas externas acidentais.
- Integracao Odoo passou a usar URL, database e usuario salvos em
  `system_settings` com fallback para env, mantendo `ODOO_PASSWORD` somente em
  SOPS/env e selecionando XML-RPC HTTP/HTTPS conforme a URL.
- Comparativo por item passou a remover prefixos operacionais `FATxx` do
  Packing List antes de confrontar com a Invoice, evitando falso erro como
  `FAT03PI7765Y` versus `PI7765Y`.
- Validacao de unidade aceita equivalencias comerciais de unidade simples
  (`PC`, `PCS`, `PCE`, `PIECE`) como `UN`, mantendo `PAR` e `SET/KIT`
  separados.
- Validacao de fabricante passou a reconhecer fabricantes no sufixo da
  descricao do item da invoice (`--FINE TEXTILE`, `--A&C`) sem aceitar sufixos
  genericos como FOC/amostra.
- Validacao de datas logisticas agora fica como `skipped` quando ha zero ou
  apenas uma data de ETD/embarque, reservando `warning`/`failed` para casos com
  contraparte real para comparar.
- Modal do e-mail de correcao agora recebe foco inicial no destinatario, fecha
  por Escape, mantem Tab dentro do dialogo e devolve foco ao botao de origem.
- Geracao manual de e-mail de correcao agora reusa rascunho KIOM aberto do
  processo, preservando edicoes do operador e evitando duplicidade.
- Envio de comunicacao por API passa a exigir `status=draft`, bloqueando
  reenvio acidental de e-mail ja enviado.
- Envio do espelho para Fenícia no frontend passou a exigir confirmação, mostrar
  estado de envio, bloquear duplo clique e atualizar processo/timeline/e-mails
  apos sucesso.
- Tabela de Produtos de Certificacoes ganhou ordenacao acessivel com botoes
  focaveis e `aria-sort`; filtros visuais passaram a expor `aria-pressed`.
- Switches visuais de agendamentos, status de usuario e seletor de tema passaram
  a declarar estado acessivel (`role="switch"`, `aria-checked`,
  `aria-expanded` e opcoes de tema com `aria-pressed`).
- Upload de documentos deixou de aceitar HTML no frontend/API, bloqueia arquivo
  acima de 50 MB no cliente, valida extensoes permitidas, usa botao acessivel e
  anuncia progresso/erro.
- Download/preview de documentos com conteudo ativo passou a forcar attachment,
  `application/octet-stream` e `X-Content-Type-Options: nosniff`.
- Criada migration SQL pendente para tabelas Pre-Cons e script de migrations
  passou a aplicar `0016_pre_cons_tables.sql`.
- CI passou a buildar/scanear/SBOM da `cert-api`; workflow de deploy passou a
  usar `scripts/deploy.sh` via rsync, alinhado ao modelo operacional real.
- `docker-compose.prod.yml` e cert-api removeram defaults sensiveis de WMS/ERP,
  Sheets e Grafana, exigindo variaveis explicitas em producao.
- Alertmanager ganhou configuracao noop segura e template separado para webhook
  real.
- Rotas internas invalidas de Importacao/Certificacoes passaram a renderizar
  estado 404 contextual em vez de layout vazio; redirect legado `/processos/*`
  preserva caminho profundo.
- Sidebar recolhida, headers de layout, login mobile, filtros, abas de processo,
  linhas navegaveis de tabelas operacionais e botoes icon-only receberam ajustes
  de acessibilidade/layout.
- Formulario de processo e API passaram a validar numeros nao negativos e datas
  coerentes; edicao de processo travado fica bloqueada no frontend.
- Cambio passou a validar valores positivos e datas coerentes no frontend/API.
- Agendamentos de certificacao passaram a validar cron no frontend e na cert-api
  antes de persistir/carregar no APScheduler.
- Produtos, relatorios e agendamentos de certificacao passaram a diferenciar erro
  de API de lista vazia, com alerta e retry.
- Proxy `/cert-api/` passou a exigir JWT valido via `auth_request` em
  `/api/auth/me` antes de injetar a chave interna da cert-api; downloads,
  exports, upload de certificado e stream de validacao agora usam fetch
  autenticado.
- Validacao automatica parcial agora e diagnostica: nao promove processo para
  `validated`, nao move pasta de correcao, nao gera rascunho KIOM e nao
  sobrescreve resultados finais.
- Validacao final passou a gravar `validation_runs` canonico com trigger,
  duracao e contadores, vinculando resultados atuais, historico e
  `document_corrections`.
- Falha de contrato Zod da IA passou a marcar `_trust.contractFailure` e capar a
  confianca abaixo do piso operacional, mantendo evidencia auditavel sem
  alimentar validacao automatica.
- Checks de certificado e proporcao de peso deixaram de aprovar quando faltam
  evidencias minimas de Invoice/itens/pesos.
- Historico de extracao e arquivado tambem antes de delete fisico de documento,
  com `process_id`, tipo, nome original e caminho do arquivo.
- SYDLE passou a usar cursor incremental por `sourceUpdatedAt` da fonte com
  overlap, matching por todos os identificadores relevantes, export CSV paginado
  sem truncamento silencioso, redaction de `raw_payload` e rotas restritas a
  administradores.
- Tela SYDLE passou a formatar `YYYY-MM-DD` sem shift de timezone; documentos de
  baixa confianca aparecem como nao utilizaveis; checks `skipped` aparecem como
  bloqueados no progresso; telas documentais distinguem erro de API de estado
  vazio.

### Tests

- Fixture representativa INV/PL/OHBL/FUP roda `allChecks` real, sem mock, e
  falha se um conjunto documental coerente produzir status `failed`.
- Cobertura de regressao garante fallback de `draft_bl` e precedencia de
  `ohbl` em `runAllChecks` e `runAnomalyDetection`.
- Cobertura de regressao garante que extrações vazias/nulas não sejam
  classificadas como documento lido no status da lista, na validação, na
  detecção de anomalias nem no Comparativo.
- Cobertura de regressao garante configuracao Odoo por banco/env e selecao
  correta do client XML-RPC HTTP/HTTPS.
- Cobertura de regressao garante foco/Escape/Tab do modal de e-mail de
  correcao e salvamento do HTML atual do editor sem depender de blur.
- Cobertura de regressao garante reuso de rascunho KIOM aberto e bloqueio de
  reenvio de comunicacao ja enviada.
- Cobertura de regressao garante confirmação e invalidações do envio Fenícia no
  preview do espelho.
- Validacao completa de 2026-06-18: `npm run -w apps/web typecheck`,
  `npm test -w apps/web -- src/features/espelhos/EspelhoPreview.test.tsx`,
  `npm test -w apps/web`, `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, `npm audit --audit-level=high` e
  `docker compose -f docker-compose.prod.yml config --quiet` com variaveis
  obrigatorias dummy.
- Playwright MCP validou o balao do Assistente IA em Importacao/Certificacoes
  desktop/mobile, incluindo envio mockado, fontes, Escape, inferencia de ID de
  processo, ausencia de overflow e ausencia de warnings/erros de console.
- Validacao de 2026-06-19: testes focados de validacao/checks (`97` testes),
  historico de extracao (`7` testes), SYDLE API (`15` testes), frontend
  documental/SYDLE (`14` testes), typecheck API/Web e lint raiz.

### Security

- `cert-api` falha fechado quando `CERT_API_KEY` nao esta configurado; somente `/api/health` e `/api/ready` ficam sem chave para healthchecks.
- Proxy `/cert-api/` do nginx do `web` valida JWT via `/api/auth/me` antes de
  injetar `X-API-Key` a partir de `CERT_API_KEY`, sem expor a chave ao browser.
- `docker-compose.prod.yml` passa a exigir `CERT_API_KEY` para `cert-api` e `web`.
- Acoes criticas de processo/documento/follow-up/espelho passaram a exigir admin: delete de processo, reprocess/delete de documento, sync manual de follow-up, delete de item de espelho, marco/envio Fenícia.
- Cadastro de usuarios no frontend foi alinhado aos papeis suportados (`admin` e `analyst`), removendo criacao visual de `operator`.
- Dependencias com vulnerabilidade alta em audit foram atualizadas ou pinadas em dev/test (`vite`, `form-data`, `@grpc/grpc-js`, `multer`); `npm audit` ficou sem `high`/`critical`.
- Comunicacoes nao aceitam mais anexos com `path` livre vindo da API; envio resolve anexos apenas por documento/espelho do mesmo processo.
- Rascunhos legados com `path` de anexo so sao enviados se o caminho bater com documento/espelho autorizado do processo.
- Trigger, varredura historica e reprocessamento de ingestao de e-mail agora exigem usuario admin.
- Anexos recebidos por e-mail respeitam limite maximo de 50 MB ou `EMAIL_ATTACHMENT_MAX_BYTES`.
- Envio de comunicacoes valida allowlist de destinatarios antes do SMTP e registra
  o usuario real na auditoria/evento.
- Assinatura de e-mail no envio passa a ser buscada pelo usuario autenticado.
- Ingestao de e-mails compara remetente pelo mailbox real normalizado, nao por
  substring no header `From`.
- Auto-sync de Pre-Cons por e-mail valida tamanho, extensao e magic bytes antes
  de processar a planilha.
- Query booleana da ingestao corrige `false` para nao virar `true`.
- `/metrics` pode ser liberado para redes privadas Docker apenas com
  `METRICS_ALLOW_PRIVATE_NETWORKS=true`.

### Verified

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- Deploy de producao do SHA `997aac4` em `192.168.168.124` com API e Web healthy.
- Revisao local posterior: `npm run -w apps/web typecheck`, `npm test -w apps/web`, `npm run -w apps/api typecheck`, `npm test -w apps/api`.
- Revisao completa posterior: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Validacao documental posterior: `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, `npm audit --audit-level=high` e
  `CERT_API_KEY=dummy docker compose -f docker-compose.prod.yml config --quiet`.

## [2026-06-11] — Parte A: motor financeiro + historização + EAN no espelho

> **Em produção desde 2026-06-11** (PR #58 merged, SHA `96a695c`, migrations 0011→0015 aplicadas). Esta seção e as duas seguintes (2026-06-01 e 2026-05-29) compõem essa entrega.

### Added

- **Motor financeiro** (`modules/financial/`): Valor Aduaneiro = (FOB+frete+seguro)×USD, Numerário = aduaneiro×0,6 + `%numerário` persistidos nas colunas existentes; `GET /api/processes/:id/financials` e `POST …/financials/recompute`; job diário (08:30) com alertas de **Invoice baixa** (<USD 20k), **Seguro/apólice** (>USD 150k → "ACIONAR SEGURADORA") e **demurrage** (free time ≤7 dias/vencido), com dedupe de alertas ativos
- **Historização para auditoria regulatória** (migration `0015`): `validation_result_history` (snapshot append-only de cada run de validação, antes do delete+recreate) e `document_extraction_history` (aiParsedData arquivado antes de reprocess/re-extração); `GET /api/processes/:id/validation-history` e `GET /api/documents/:id/extraction-history`
- **Espelho ancorado em EAN (groundwork)**: extração de `ean` por item na INV e no PL (com regra anti-alucinação), validador GTIN (check digit) no harness, join PL×INV por EAN com fallback para itemCode, enriquecimento via base EAN Puket (`ai/knowledge/ean.json`, só quando o candidato é único) com `eanSource: document|kb`. Layout do XLSX do espelho **inalterado** (pende alinhamento com a Odett)
- `scripts/linx_discovery.py` no cert-api: descoberta de schema do Linx via CLI (`docker exec importacao-cert-api python scripts/linx_discovery.py puket`), sem SSMS

### Changed

- `deploy.sh` aplica as migrations pendentes automaticamente (passo 4.5) via `apply-pending-migrations.sh` (0011→0015)
- Pasta do Drive para a sync da Pre-Cons criada ("Pre-Cons (sync portal importação)", ID `1OJmEV1GTI7vC0B-Uxb-btgQRMDu0530B`) — falta compartilhar com a SA e setar `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`

---

## [Unreleased] — 2026-06-01 — Cadastro de certificado + escrita no Linx (PROP_PRODUTOS)

### Added

- **Tela "Cadastrar Certificado"** no painel de Certificações (`/certificacoes/cadastro`): formulário com marca/loja, SKU, validade do certificado, vencimento do licenciamento, nº do certificado, OCP, órgão certificador e upload de PDF; lista de recentes + botão "Reenviar ao Linx"
- **Escrita automática no Linx** ao salvar: upsert das datas em `PROP_PRODUTOS` por marca — Puket props `00224`/`00225`, Imaginarium `00106`/`00107` (`linx_service.py` + helpers em `db/sqlserver.py`)
- **API** (`routes/certificates.py`): `POST /api/certificates` (multipart + PDF), `GET /api/certificates`, `GET /api/certificates/{id}`, `GET …/pdf`, `POST …/retry-linx`
- Tabela de auditoria `cert_certificates` (PostgreSQL) com `linx_status`/`linx_error`/`linx_detail`
- Config `LINX_*` parametrizável por env + `python-multipart` como dependência
- `sql/linx_discovery.sql` (query read-only de descoberta de schema) e docs `CERT-LINX-WRITE.md`
- 31 testes (`tests/test_linx_service.py` + `tests/test_certificates_routes.py`): formatação de data, fail-closed, resolução de marca, guarda de identificador SQL (inclui schema-qualificado `dbo.tabela`) e integração das rotas (auth, validação de input, PDF forjado, happy path, retry)
- Índice `cert_certificates(brand, linx_status)` para reprocesso em massa; aviso no formulário quando a data informada está no passado

### Changed

- CI endurecido: lint (api/web) e pytest do cert-api agora bloqueiam o pipeline (removido `|| true`); 42 warnings de ESLint zerados
- SMTP do worker de e-mail valida certificado TLS em produção (override explícito via `SMTP_TLS_REJECT_UNAUTHORIZED=false` para relay interno)
- Login fail-closed: sem `GOOGLE_GROUP_ALLOWED` configurado ninguém entra (allow-all antigo só com `GOOGLE_GROUP_ALLOW_ALL_WHEN_UNSET=true` explícito)

### Security

- **Fail-closed**: nada é gravado no Linx enquanto `LINX_WRITE_ENABLED=false` (evita escrever em produção com schema não confirmado); resolução SKU→produto recusa gravar sem mapeamento configurado
- Upsert anti-race/anti-trigger: `UPDATE … WITH (UPDLOCK, HOLDLOCK)` + `SET NOCOUNT ON; SELECT @@ROWCOUNT`; identificadores validados por regex e valores sempre como bind params
- Upload de PDF validado por extensão **e** magic bytes `%PDF-`, limite 15 MB, nome derivado de UUID

---

## [Unreleased] — 2026-05-29 — Camada de confiança da IA + UAT Odett

### Added

- **Provider Vertex AI** ativado em runtime (privacidade por contrato) + teto de custo mensal (R$150 ≈ USD 26); KB copiada para `dist/` no build
- **Harness de confiança da IA** (`ai/harness/`): grounding anti-alucinação, validadores de formato (NCM, container ISO 6346 com check-digit, CNPJ, USD), consistência numérica e validação contra a base de conhecimento; gate força revisão humana em erro
- **Skills por documento** (`ai/skills/`) = schema + receita de verificação
- **Base de conhecimento** (`ai/knowledge/`): NCMs, portos, fornecedores, armadores, tarifas, EAN Puket (extraída da planilha Follow Up)
- Migration `0014` (`validation_results.resolution_note`) registrada em `apply-pending-migrations.sh` + `deploy.sh`
- Job de sync da Pre-Cons no scheduler (aguarda `GOOGLE_DRIVE_PRE_CONS_FOLDER_ID`)
- Docs: `AI-HARNESS.md`, `REVISAO-100.md`, `ODETT-STATUS.md`; testes novos (harness, processor-codes, parse-precons, flatten-ai-data)

### Fixed (UAT Odett IM0712602NB)

- #1 códigos de processo: regex restrito ao formato Uni.co + gate do código sugerido pela IA (não captura mais PI/INV/NCM)
- #2 BL: `issueDate` (data de emissão real) em vez da data de upload rotulada como "emitido"
- #3 descrição da carga expansível nas tabelas comparativas
- #4 declaração de madeira detectada no BL Final
- #7 INV lida: schema alinhado ao prompt + classificação por conteúdo + gate degradável (`hasRelevantData`)
- #8 PL não mistura quantidade com faturamento (regra + check de quantidade inteira)
- #9 checklist de validação com status `skipped` (despoluída)
- #10 "resolver manualmente" exige justificativa + recomputa status
- Pre-Cons: delete em transação (arquivo ruim não zera a tabela); parser validado contra dados reais
- CI: vuln HIGH `tmp` (Path Traversal) resolvida via `npm audit fix`

---

## [Unreleased] — 2026-04-05

### Added

- Cert-API refactored from 2938-line monolith into modular structure (`app/`)
- pytest test suite for cert-api (test_cert_service, test_health, test_stock, test_routes)
- `pyproject.toml` for cert-api with uv-compatible dependency management
- `docs/RUNBOOK.md` — troubleshooting, rollback, backup/restore procedures
- `docs/ONBOARDING.md` — zero-to-running setup guide
- `docs/adr/` — 5 Architecture Decision Records
- `apps/cert-api/docs/DEVELOPMENT.md` — cert-api development guide
- `apps/cert-api/README.md` updated with new architecture
- `/api/ready` readiness endpoint in cert-api

---

## [2.5.0] — 2026-04-03 (6cb6f75)

### Added

- `animate-fade-in` to SettingsPage
- Premium UI polish: shimmer skeletons, Apple cubic-bezier transitions, micro-interactions
- All MEDIUM pentest findings fixed (rate limiting, security headers, XSS)

### Fixed

- XSS: DOMPurify.sanitize() on all dangerouslySetInnerHTML
- SMTP: TLS rejectUnauthorized=true in production + CRLF injection sanitization
- Auth: password minimum 8 chars, failed login audit logging

---

## [2.4.0] — 2026-04-03 (14ff181)

### Added

- Enterprise design system v2: semantic color tokens, Inter font, sidebar navy
- Banned raw color classes (blue-_, red-_, gray-\*) — replaced with semantic tokens
- Shimmer loading skeletons, layered card shadows, stagger-children animations

---

## [2.3.0] — 2026-03-xx (4516f33)

### Added

- Pre-Cons module: automatic sync via email + manual upload
- Support for 10+ document formats: Word, TIFF, CSV, HTML, EML, BMP
- Professional AI summaries for extraction results (PT-BR)

### Fixed

- Pre-cons parser: safe number parsing to avoid NaN in database
- Pre-cons quantities rounded to integer (KIOM data has decimals)
- AI comparison using raw { value, confidence } instead of flat values

---

## [2.2.0] — 2026-03-xx (3eabd97)

### Added

- Process timeline/event history (`process_events` table, migration 0009)
- Email signatures CRUD (up to 4 per user, `email_signatures` table, migration 0008)
- Draft BL: upload + 10-item checklist + AI extraction + comparison view
- Logistic flow: 11 stages (consolidation → internalized) with sub-info and manual override

---

## [2.1.0] — 2026-03-xx (b463c74)

### Added

- Cert-API stock integration: WMS Oracle + ERP SQL Server (Puket, Imaginarium)
- Licenciados (LPCO tracking) from Google Sheets
- Validation schedules with cron expressions and APScheduler
- cert_stock table with WMS storage areas and e-commerce stock

### Changed

- Certification comparison: ecommerce_description takes priority over certification_type

---

## [2.0.0] — 2026-03-xx (5b90a34)

### Added

- First complete delivery: document validation + certification + stock
- Cert-API microservice (Python FastAPI) for VTEX certification validation
- Google Sheets integration for certification data (Imaginarium, Puket, Puket Escolares)
- Encerramentos tab support: "Venda até fim do lote" never expires
- Validation runs with SSE progress streaming
- Excel report generation (openpyxl)

---

## [1.5.0] — 2026-02-xx (1c2902d)

### Added

- Complete QA pass: security, performance, visual, DX improvements
- Mobile responsiveness across 15 files
- AI multimodal support for scanned PDFs and images

---

## [1.0.0] — 2026-01-xx (c67760c)

### Added

- Initial technical architecture and execution plan
- Express API with Drizzle ORM and PostgreSQL
- React + Vite frontend with Tailwind CSS
- Docker Compose multi-service setup
- JWT authentication, email ingestion via Gmail API
- Import process management with 11 logistic stages
- Document upload and AI extraction (Gemini 2.5 Flash)

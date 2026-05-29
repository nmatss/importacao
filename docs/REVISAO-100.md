# Revisão 100% — Projeto Importação (gap analysis + backlog)

**Gerado em:** 2026-05-29 · 14 agentes · 13 revisões · cruzando a planilha Follow Up (fonte da verdade) + feedback de UAT da Odett.

> Artefato gerado pela Onda 1 de revisão. Editável; serve de backlog vivo da entrega 'Parte A 100%'.

## 1. Feedback da Odett (UAT IM0712602NB) — veredito + fix

### #1 — Ainda trazendo emails de PIs e itens como código de processo (falsos positivos)

- **Veredito:** bug-confirmado · **esforço:** médio
- **Causa-raiz:** extractAllProcessCodes (processor.ts:23-50) usa padrões catch-all: /\b([A-Z]{2,10}[-_]\d{4}[-_]\d{2,}[A-Z]{0,4})\b/ e /\b(\d{4}[-/]\d{5,})\b/ rodando em subject E nos 3000 primeiros chars do body (479-490); capturam PI (PI-2024-042), invoice (INV-2025-00123), PO, telefone, NCM. fuzzyMatchProcessCode (354-390) faz ilike '%code%' + wildcard de dígitos, casando processos espúrios (candidato '0712' casa IM0712602NB). hasProformaSignal não exclui PI de código de PROCESSO. detectBrand defaulta 'puket' por substring frágil.
- **Fix:** apps/api/src/modules/email-ingestion/processor.ts:23-50 (restringir regex ao formato Uni.co IM/PK\d{7}[A-Z]{0,4} + IMP-AAAA-NNN), :354-390 (exigir comprimento>=7, remover wildcard de dígitos, ORDER BY determinístico, não auto-vincular em ambiguidade), :255-323 (extractInvoiceNumbers/extractDocumentTypesFromText), :562-629 (não auto-criar processo de candidato fraco); ai/prompts/email-analysis.ts:21-22 (remover padrões genéricos do prompt)

### #2 — BL 'BL Final emitido 09/04/2026' errado (emitido != atualizado; mostra data de upload)

- **Veredito:** bug-confirmado · **esforço:** pequeno
- **Causa-raiz:** bl-response.ts não tem campo de data de emissão (só shipmentDate/etd/eta, confirmado linha 21); prompt bl.ts também não pede 'Date of Issue'. UI DraftBLTab.tsx:968 usa ohblDoc.uploadedAt e :871 renderiza literalmente 'BL Final emitido {ohblDate}'; o mesmo uploadedAt é rotulado 'atualizado' em :444 — inconsistência. issueDate só existe em certificate-response.ts.
- **Fix:** apps/api/src/modules/ai/prompts/bl.ts (adicionar issueDate/'Place and Date of Issue'/'Date of Issue'), apps/api/src/modules/ai/schemas/bl-response.ts (adicionar issueDate); apps/web/src/features/processes/components/DraftBLTab.tsx:871,968 (usar issueDate extraído ou rotular 'recebido/upload em')

### #3 — Descrição da Carga do BL cortada (line-clamp)

- **Veredito:** bug-confirmado · **esforço:** trivial
- **Causa-raiz:** DraftBLTab.tsx:595 usa className line-clamp-6 em cargoDescription sem botão 'ver mais'; AiExtractionSummary.tsx:183 filtra cargoDescription do resumo; comparativo usa max-w-[150px] truncate (:758,763). O dado completo existe no backend (bl-response.ts:30 cargoDescription string).
- **Fix:** apps/web/src/features/processes/components/DraftBLTab.tsx:595 (toggle expand/collapse ou remover clamp); apps/web/.../AiExtractionSummary.tsx:183 (incluir bloco dedicado de cargoDescription)

### #4 — Declaração de madeira não achada no BL FINAL (woodDeclaration falta no schema/prompt)

- **Veredito:** feature-faltante · **esforço:** pequeno
- **Causa-raiz:** woodDeclaration/ncmList existem só no DRAFT (draft-bl-response.ts:31-32 confirmado, draft-bl.ts:65,76) e NÃO no BL FINAL (bl-response.ts não tem, bl.ts não pede). documents/service.ts:281-285 roteia ohbl→extractBLData(blResponseSchema). UI DraftBLTab.tsx:426 lê getFieldValue(data,'woodDeclaration') também no final → sempre null → alerta/card vazio mesmo estando no documento.
- **Fix:** apps/api/src/modules/ai/prompts/bl.ts (adicionar woodDeclaration+ncmList+freeTime espelhando draft-bl), apps/api/src/modules/ai/schemas/bl-response.ts (adicionar os campos); FIELD_LABELS.ohbl em AiExtractionSummary.tsx; reprocessar OHBL do IM0712602NB

### #5 — Não trouxe os dados da precons

- **Veredito:** bug-confirmado · **esforço:** grande
- **Causa-raiz:** Cascata de causas: (a) Pre-Cons NUNCA sincroniza desta planilha — scripts/import-follow-up.js:231 só lê aba 'Processos', scheduler.ts não agenda preConsService.syncFromDrive; único gatilho é email com /pre.?cons/; (b) parser exige header literal 'Order'+'ETD' nas 5 primeiras linhas (service.ts:122-136), senão pula em silêncio; processCode vem da 2ª coluna 'Order' (:78-80); (c) getByProcessCode (:416) faz eq exato sem normalização/fuzzy; (d) cruzamento documentos↔pre-cons só via Proforma+piNumber (documents/service.ts:683-766). Verificado nas revisões: a aba PreCons contém IM0712602NB 7x mas a sync nunca rodou. Também GOOGLE_DRIVE_PRE_CONS_FOLDER_ID ausente no .env/compose.
- **Fix:** scripts/import-follow-up.js:231 (parsear aba PreCons); apps/api/src/jobs/scheduler.ts (cron syncFromDrive); apps/api/src/modules/pre-cons/service.ts:78-136 (header tolerante+log de sheets puladas),:416 (normalizar/fuzzy),:227 (delete+insert em transação); docker-compose.prod.yml + .env (GOOGLE_DRIVE_PRE_CONS_FOLDER_ID); documents/service.ts:getComparison (incluir coluna Pré-Cons por processCode)

### #6 — Os docs baixados estão vindo do email ou do drive? (pergunta)

- **Veredito:** pergunta-respondida · **esforço:** trivial
- **Causa-raiz:** Resposta: os documentos são capturados do EMAIL (anexos via Gmail API/IMAP da caixa configurável GMAIL_SHARED_MAILBOX) na ingestão, salvos no disco local (UPLOAD_DIR) e copiados para o Google Drive (INBOX→PROCESSADOS). O download na UI serve a cópia LOCAL (controller.ts:76 res.sendFile); só redireciona para o Drive (302) se o arquivo local sumiu e há driveFileId (controller.ts:65-67). getSource (service.ts:1054-1086) rotula a origem como 'email' ou 'manual'. Única fonte que pode vir do Drive é a planilha Pre-Cons (syncFromDrive). Nenhuma ação de código necessária — apenas expor o badge de origem na UI.
- **Fix:** Nenhum fix necessário; opcional: apps/web/.../DocumentList.tsx (carregar source na listagem e exibir badge Mail/Upload/Drive sempre visível)

### #7 — Não está lendo nada da INV (CAUSA-RAIZ em cascata)

- **Veredito:** bug-confirmado · **esforço:** grande
- **Causa-raiz:** Múltiplas causas que se somam: (a) classificação: INV nomeada só com código de processo (IM0712602NB.pdf) cai em 'other' (processor.ts:71-163) e o branch default não extrai (documents/service.ts:290-339); INV com 'PI<digits>' no nome é sequestrada como proforma (processor.ts:97-102, confirmado) e proforma não conta para documents_received nem dispara comparação; (b) schema: invoiceResponseSchema (confirmado) NÃO declara exporterTaxId, importerCnpj nem items[].isFreeOfCharge/boxQuantity/netWeight/grossWeight que o prompt pede e o Comparativo lê — structured-output proíbe o Gemini de emiti-los → campos sempre null; (c) gate: auto-validação (service.ts:492) e auto-espelho (:556) exigem invoice && packing_list && ohbl — sem INV, NADA dispara silenciosamente; (d) confidence<0.4 (service.ts:431) faz early-return e não regrava tipo; (e) cross-match item PL×INV (item-level-match.ts:59-67) usa itemCode exato sem normalização → falsos failed.
- **Fix:** apps/api/src/modules/email-ingestion/processor.ts:71-163 (classificar 'other' por conteúdo/IA, não só nome),:97-102 (não classificar proforma por 'PI<digits>'); apps/api/src/modules/ai/schemas/invoice-response.ts (adicionar exporterTaxId/importerCnpj/isFreeOfCharge/boxQuantity/netWeight/grossWeight); apps/api/src/modules/documents/service.ts:431-453 (reavaliar gate após low-confidence),:492/:556 (geração/validação parcial+alerta explícito); apps/api/src/modules/validation/checks/item-level-match.ts:59-67 (usar item-code-normalize)

### #8 — Lendo itens junto com o fat no PL (mistura quantidade × preço/faturamento)

- **Veredito:** incompleto · **esforço:** pequeno
- **Causa-raiz:** Prompt do PL (packing-list.ts:48-58) está estruturalmente correto (item só tem quantity/boxQuantity/netWeight/grossWeight, sem unitPrice) e tem regra anti-embalagem/anti-coleção, mas NÃO tem regra explícita proibindo ler colunas de PRICE/AMOUNT/FOB/USD como quantity quando o layout do PDF as cola. invoice.ts:82-84 tem regra anti-concatenação de código mas nem PL nem INV têm regra separando coluna de QUANTIDADE da de FATURAMENTO. Em PDFs combinados INV+PL ou layout compacto, a IA preenche quantity com valor monetário e o cross-match (#7) quebra.
- **Fix:** apps/api/src/modules/ai/prompts/packing-list.ts (adicionar: 'PL NÃO contém preço/valor; quantity=unidades PCS/PAR/SET; ignore colunas USD/AMOUNT/FOB/valor; validar quantity != amount'); apps/api/src/modules/ai/prompts/invoice.ts (reforçar separação quantity vs unitPrice/totalPrice). Depende de #7 resolvido.

### #9 — Checklist de Validação 'bem poluída' porque a INV não é lida

- **Veredito:** incompleto · **esforço:** médio
- **Causa-raiz:** validation/service.ts:79 roda os 27 checks incondicionalmente; ~20 dependem de invoiceData (incoterm, currency, fob-calculation, manufacturer, payment-terms, unit-type, item-level-match, net-weight, dates-match, ports-match, exporter/importer-match, etc.) e retornam 'warning'/'failed' quando a INV está ausente em vez de 'skipped'. O enum do banco tem 'skipped' mas o tipo CheckResult.status (index.ts:39, confirmado) só permite passed|failed|warning — nenhum check emite skipped. ncm-bl-description compara prefixo NCM numérico contra texto livre do BL → quase sempre failed estrutural. freight-value-match e freight-vs-fup são redundantes. Falsos failed disparam alerta crítico + email KIOM indevido.
- **Fix:** apps/api/src/modules/validation/checks/index.ts:39 (adicionar 'skipped' ao tipo); todos os checks dependentes de INV (retornar skipped quando doc-fonte ausente); validation/service.ts (não contar skipped em severidade/email KIOM); ncm-bl-description.ts:41-65 (rebaixar para warning ou validar via catálogo); apps/web/.../ValidationChecklist.tsx (seção colapsável 'Bloqueados por documento ausente'). Depende de #7.

### #10 — 'Resolver manualmente': um clique marca como ajustado sem validar nada (o que é exatamente?)

- **Veredito:** funciona-como-projetado · **esforço:** médio
- **Causa-raiz:** resolveManually (service.ts:330-348, confirmado) apenas seta resolvedManually/resolvedBy/resolvedAt e loga audit 'manual_resolution' com details=null; NÃO recebe/grava justificativa (o body {resolution} do front é ignorado), NÃO revalida, NÃO reabre quando os dados mudam. Semanticamente é um OVERRIDE/ACEITE manual auditado da divergência — não uma revalidação. Além disso, o status agregado (hasFailed, :118) ignora resolvedManually, então o processo nunca sai de pending_correction só por resolução manual.
- **Fix:** apps/api/src/modules/validation/service.ts:330-348 (exigir resolution_note obrigatória, gravar valor divergente no momento, registrar no audit; recomputar status agregado e promover processo quando todos os failed estiverem resolvedManually; invalidar resolução quando extração muda); schema.ts:218-220 (coluna resolution_note); controller.ts:37-50 (ler req.body); apps/web/.../ValidationChecklist.tsx:272-282 (campo de justificativa + tooltip 'aceite manual, não revalida'). Resposta à Odett: é supressão manual de auditoria, não conferência automática.

## 2. Matriz de cobertura (domínio exige × implementado)

- **[NÃO]** Motor financeiro: Valor Aduaneiro=(FOB+frete+seguro)*USD; Numerário=Aduaneiro*0,6; %numerário
  - gap: Colunas numerarioValue/numerarioPct existem mas NÃO há lógica de cálculo das fórmulas (grep 0.6/valorAduaneiro vazio). Numerário/Desembaraço são views read-only sobre /processes.

- **[NÃO]** Status Valor Invoice (alerta 'Invoice baixa' < USD 20k)
  - gap: Regra Manual col18 não implementada.

- **[NÃO]** Alerta de Seguro / cobertura de apólice (>USD~150k → ACIONAR SEGURADORA)
  - gap: insuranceValue existe no schema mas não há regra de alerta de cobertura nem aba Seguros modelada.

- **[NÃO]** Controle de demurrage/armazenagem por terminal (PORTONAVE/APM/Itapoá/LOCALFRIO)
  - gap: Só freeTimeDays no schema; sem cálculo de vencimento 1º/2º período, custo por tarifa nem alerta de demurrage. Tarifas da aba Premissas não modeladas.

- **[NÃO]** Rastreio de alteração de NCM com impacto tributário (II/IPI/PIS/COFINS, ganho/perda)
  - gap: Aba ALTERAÇÕES NCMs sem tabela/serviço; só checks de NCM no BL.

- **[NÃO]** Relatório de licenciamento com estoque (WMS Biguaçu + e-commerce Extrema, por filial virtual, exceto lojas)
  - gap: Requisito da reunião não evidenciado no código; sem integração de estoque por filial virtual.

- **[NÃO]** Versionamento/histórico de validações e extrações (auditoria regulatória)
  - gap: validation/service.ts:93-110 deleta e recria validationResults a cada run (zero histórico); reprocess zera aiParsedData.

- **[NÃO]** Fluxos satélite Back to Back e Exportação
  - gap: Sem módulo correspondente; abas presentes na planilha.

- **[PARCIAL]** Modelo de dados do processo (~108 colunas aba Processos/Manual)
  - gap: importProcesses cobre o núcleo; ~30 colunas vivem em aiExtractedData (JSONB) ou não mapeadas (Seguro/Alerta Seguro, Free Time/Demurrage, Conexões, Porto Omitido, Atraso Omissão, ETA Médio, vários TT). follow-up DB cobre ~50 de ~80.

- **[PARCIAL]** Status logístico DERIVADO por máquina de estados (HOJE vs ETD/ETA)
  - gap: VALID_LOGISTIC_STATUSES + advanceLogisticStatus existem, mas falta confirmar que os limiares de data batem com a fórmula Manual col1 e o estado final 'Encerrado/CD Quarentenado' pós Entrada NF.

- **[PARCIAL]** FOB = SOMASE dos itens da PreCons por referência
  - gap: Há checks de FOB (fob-calculation) e fob-vs-fup, mas o cálculo a partir da PreCons depende da sync da PreCons (que não roda) e da INV lida.

- **[PARCIAL]** Status LI/LPCO derivado cruzando NCMs com órgãos (Inmetro/MAPA/ANVISA)
  - gap: li-tracking e prazo D+13 existem; prefixos NCM LI corretos em espelhos/service.ts:26-36. Falta cruzamento estruturado com abas LIs/LPCOSs e derivação de status por órgão.

- **[PARCIAL]** Checklist operacional (col 72-88) mapeado em followUpTracking
  - gap: ~11 marcos mapeados; faltam contagem/tipo de erros da correção documental; só 4 de 15 milestones sincronizam para o Sheet (MILESTONE_COLUMNS).

- **[PARCIAL]** Motor de validação documental (NCM no BL, frete, CBM, FOB, coerência 3 docs)
  - gap: 27 checks implementados, mas sem status 'skipped', com falsos failed estruturais (ncm-bl-description) e dependência da INV não lida; não consome PreCons como base de comparação (CheckInput sem preConsData).

- **[PARCIAL]** Espelho automático por marca (Puket/Imaginarium) ancorado em EAN
  - gap: 3 caminhos existem mas o template gerado não reproduz o layout real (sem EAN/PRODUTO/GRADE/LINHA); join por itemCode exato, não por EAN; não consome Base EAN; exige invoice+PL+BL e ancora itens só na INV.

- **[PARCIAL]** Ingestão de e-mail + classificação por IA + auto-transição
  - gap: Funciona mas com regex frágil (#1), classificação por nome derruba INV em 'other' (#7), proforma hijack por 'PI<digits>', e propagação de uma classificação para múltiplos anexos genéricos.

- **[PARCIAL]** Disparo de e-mail (templates Fenícia/ISA/KIOM) + múltiplas assinaturas + SMTP
  - gap: Templates Fenícia/ISA/KIOM existem e wired; faltam templates 'Coletar Assinaturas'/Controladoria; worker SMTP duplica transporte com rejectUnauthorized:false. Confirmar relay global e assinaturas múltiplas em runtime.

- **[PARCIAL]** 4 status semânticos de certificação ('Conforme'/'Inconsistente'/'Não Encontrado'), sem 'Ausente' nem % provisório
  - gap: derivation.py:6-9 deriva 4 status (commits recentes); confirmar na UI que 'Ausente' foi removido e a % de similaridade não é exposta como pontuação ao usuário; coluna 'Prazo Final de Venda' separada da validade.

- **[PARCIAL]** Certificações integrando VTEX + WMS Oracle + ERP + órgãos ANVISA/MAPA/ABNT
  - gap: VTEX scraping implementado (cert_service.py:128-353) e mais órgãos (derivation.py:20); manual não documenta VTEX; integração WMS/ERP a confirmar.

- **[PARCIAL]** Privacidade via Vertex AI (provider self-hosted Google)
  - gap: Código pronto (vertex.ts) mas DESLIGADO em runtime: AI_PROVIDER default 'openrouter', GOOGLE_VERTEX_PROJECT vazio, não repassado no compose; ESPELHO_AI_FALLBACK exige vertex.

## 3. Backlog priorizado

### #1 [CRITICAL/grande] Destravar leitura da INV: schema invoice + classificação + gate degradável (causa-raiz em cascata #7)

- área: ai+email-ingestion+documents
- files: apps/api/src/modules/ai/schemas/invoice-response.ts (add exporterTaxId/importerCnpj/isFreeOfCharge/boxQuantity/netWeight/grossWeight); apps/api/src/modules/email-ingestion/processor.ts:71-163,97-102; apps/api/src/modules/documents/service.ts:431-453,492,556
- risco: Alterar structured-output schema pode mudar shape de extrações existentes; reprocessar IM0712602NB para validar. Re-roteamento de 'other'→IA aumenta custo/latência de IA.

### #2 [HIGH/médio] Status 'skipped' nos checks dependentes de INV + limpar falsos failed (ncm-bl-description, item-match) — resolve poluição #9

- área: validation
- files: apps/api/src/modules/validation/checks/index.ts:39; checks/\*.ts dependentes de INV; validation/checks/item-level-match.ts:59-67 (item-code-normalize); validation/checks/ncm-bl-description.ts:41-65; validation/service.ts (não contar skipped em severidade/email KIOM); apps/web/.../ValidationChecklist.tsx
- depende: 1
- risco: Mudar status de checks pode alterar contagem de dashboard; revisar nonKiomChecks para não disparar email indevido.

### #3 [CRITICAL/grande] Sincronizar Pre-Cons desta planilha + matching tolerante + cruzar no processo (#5)

- área: pre-cons+infra
- files: scripts/import-follow-up.js:231; apps/api/src/jobs/scheduler.ts; apps/api/src/modules/pre-cons/service.ts:78-136,227,416; docker-compose.prod.yml + .env (GOOGLE_DRIVE_PRE_CONS_FOLDER_ID); documents/service.ts getComparison
- risco: DELETE ALL não-transacional pode zerar tabela com arquivo ruim; envolver em transação. Header tolerante pode casar sheets erradas — logar puladas.

### #4 [HIGH/pequeno] BL FINAL: portar woodDeclaration/ncmList/freeTime + adicionar issueDate (data de emissão real) #4 e #2

- área: ai+web
- files: apps/api/src/modules/ai/prompts/bl.ts; apps/api/src/modules/ai/schemas/bl-response.ts; apps/web/.../DraftBLTab.tsx:871,968; AiExtractionSummary.tsx FIELD_LABELS.ohbl
- risco: Reprocessar OHBLs existentes para popular novos campos; baixo risco de regressão.

### #5 [HIGH/médio] Restringir regex de código de processo ao formato Uni.co + gate fuzzy + não auto-criar de candidato fraco (#1)

- área: email-ingestion
- files: apps/api/src/modules/email-ingestion/processor.ts:23-50,354-390,562-629; ai/prompts/email-analysis.ts:21-22
- risco: Regex muito estrito pode perder códigos legítimos com formato atípico; cobrir com fixtures e manter fuzzy contra DB como gate.

### #6 [HIGH/pequeno] Regra anti-concatenação quantidade×faturamento no prompt do PL (#8)

- área: ai
- files: apps/api/src/modules/ai/prompts/packing-list.ts; apps/api/src/modules/ai/prompts/invoice.ts
- depende: 1
- risco: Baixo; ajuste de prompt. Validar com PLs combinados INV+PL reais.

### #7 [HIGH/médio] 'Resolver manualmente': justificativa obrigatória + recompute de status + audit detalhado (#10)

- área: validation+web
- files: apps/api/src/modules/validation/service.ts:330-348,118; schema.ts:218-220 (resolution_note); validation/controller.ts:37-50; apps/web/.../ValidationChecklist.tsx:272-282
- depende: 2
- risco: Migration de schema (nova coluna); recompute de status pode promover processos automaticamente — testar transição.

### #8 [MEDIUM/trivial] Descrição da Carga expansível na UI (#3)

- área: web
- files: apps/web/.../DraftBLTab.tsx:595; AiExtractionSummary.tsx:183
- risco: Nenhum.

### #9 [HIGH/grande] Espelho real: layout ancorado em EAN + Base EAN + join por EAN (não só itemCode)

- área: espelhos+ai
- files: apps/api/src/modules/espelhos/templates/puket.template.ts:19-34, imaginarium.template.ts; documents/utils/build-espelho.ts:20-49; ai/prompts/invoice.ts+packing-list.ts (extrair EAN); espelhos/service.ts:128-147
- depende: 1
- risco: Requer ingestão da Base EAN; mudança de layout do XLSX impacta despachante — alinhar com Odett antes.

### #10 [MEDIUM/grande] Motor financeiro: Valor Aduaneiro/Numerário/%numerário + alerta Invoice baixa + alerta Seguro + demurrage

- área: processes+domínio
- files: novo serviço em modules/processes; tabela de Premissas (tarifas); jobs/deadline-check.ts (seguro+demurrage); schema.ts
- depende: 3
- risco: Depende de parâmetros Premissas versionados e taxa USD; sanitizar #REF!/#VALUE! da planilha na ingestão.

### #11 [HIGH/médio] Ativar Vertex AI em runtime (privacidade) + repassar env vars no compose

- área: infra+ai
- files: docker-compose.prod.yml (AI_PROVIDER/GOOGLE_VERTEX_PROJECT/LOCATION + env_file); .env/.env.example; config/env.ts (validar); SA n8n-grupo-unico roles/aiplatform.user
- risco: SA precisa de role aiplatform.user e Vertex API habilitada; sem isso a 1ª extração estoura. Rotacionar a private key exposta em claro no .env.

### #12 [MEDIUM/médio] Historizar validation_results e extrações por run (auditoria regulatória)

- área: validation+documents
- files: apps/api/src/modules/validation/service.ts:93-110; documents/service.ts:1125-1128; schema.ts (run_id/append-only)
- depende: 2
- risco: Crescimento de tabela; definir retenção.

### #13 [MEDIUM/médio] Completar sync de milestones para o Sheet + templates Controladoria/Assinaturas

- área: integrations+communications
- files: apps/api/src/modules/integrations/google-sheets.service.ts:38-43; communications/templates; follow-up/service.ts
- risco: Mapear colunas exatas da planilha Follow Up real para evitar escrever na coluna errada.

### #14 [HIGH/grande] Hardening infra/segurança: SOPS/secrets, migrations no deploy, TLS, CI gates reais, SMTP TLS

- área: infra
- files: deploy.sh:203-237; docker-compose.prod.yml (TLS/nginx prod.conf); ci.yml:23,38,110 (remover || true); workers.ts handleEmailSend (TLS verify); auth/google-groups.service.ts:30-34 (fail-closed)
- risco: ALTER TYPE da migration 0011 fora de transação; rotação de secrets invalida sessões. Mudar gate de CI pode quebrar pipeline até lint limpo.

### #15 [MEDIUM/médio] Pre-Cons no CheckInput + checks de comparação INV/PL × Pre-Cons (qtd, preço, ETD, coleção)

- área: validation+pre-cons
- files: apps/api/src/modules/validation/checks/index.ts (preConsData); novos checks; validation/service.ts:47-69
- depende: 3
- risco: Depende da sync da Pre-Cons funcionando.

## 4. Prontidão Vertex AI

Vertex está pronto no código (apps/api/src/modules/ai/providers/vertex.ts) mas NÃO funciona em runtime. Para 100%: (1) service.ts:179 lê AI_PROVIDER que defaulta para 'openrouter' — setar AI_PROVIDER=vertex; (2) vertex.ts:124,128,144 exige GOOGLE_VERTEX_PROJECT (hoje vazio) e GOOGLE_VERTEX_LOCATION — definir ambos; (3) essas env vars NÃO são repassadas pelo docker-compose.prod.yml (sem env_file nem environment para elas) — adicionar ao service api ou usar env_file:[.env]; (4) a Service Account reusada (a mesma do Drive, n8n-grupo-unico) precisa do role roles/aiplatform.user no projeto e da Vertex AI API habilitada, senão a 1ª extração estoura (vertex.ts:140-141); (5) config/env.ts não valida essas vars — adicionar AI_PROVIDER como enum com refinement exigindo GOOGLE_VERTEX_PROJECT quando vertex, para fail-fast; (6) só então ligar ESPELHO_AI_FALLBACK=1 (service.ts:653-654 exige vertex para o fallback de espelho por privacidade); (7) templates .env.example/.env.sops.yaml.example estão desatualizados — sincronizar com as vars Vertex; (8) modelo de upgrade gemini-2.5-pro não está na MODEL_FALLBACK_CHAIN (service.ts:71) — incluir para o upgrade-on-low-confidence não cair de volta no Flash. Bloqueador de segurança paralelo: a GOOGLE_DRIVE_PRIVATE_KEY (mesma SA que o Vertex reusa) está em texto claro no .env do working tree e foi exposta — rotacionar antes do switch.

## 5. Top riscos

- CAUSA-RAIZ EM CASCATA #7 (INV não lida) bloqueia simultaneamente auto-espelho, auto-validação, cross-match item PL×INV e polui a checklist — qualquer correção isolada dos outros itens (#8,#9) tem efeito limitado enquanto a INV não for classificada+extraída com schema completo. É o gargalo único a atacar primeiro.
- Pre-Cons NUNCA sincroniza desta planilha (import-follow-up.js só lê aba 'Processos', sem cron de syncFromDrive, GOOGLE_DRIVE_PRE_CONS_FOLDER_ID ausente) e o delete-all não-transacional pode zerar a tabela com um arquivo ruim — risco operacional de perda total de Pre-Cons.
- Chave privada de Service Account e GOOGLE_CLIENT_SECRET em texto claro no .env do servidor (SOPS falha em todo deploy); a mesma SA seria reusada pelo Vertex — exposição de credencial que exige rotação imediata.
- Auditoria regulatória comprometida: validation_results é deletado/recriado a cada run e ai_parsed_data é sobrescrito no reprocess — zero histórico de divergências/correções, num contexto de importação fiscalizável.
- Falsos failed estruturais (ncm-bl-description compara prefixo NCM numérico contra texto livre do BL; item-level-match por itemCode exato) disparam alerta crítico + email automático de correção KIOM indevido ao fornecedor — ruído externo e perda de confiança no sistema.
- Produção HTTP-only (TLS configurado mas não usado pelo compose prod) + JWT em localStorage (XSS, ADR aceito como dívida) + auto-provisionamento de usuário Google com isAllowed=allow-all quando GOOGLE_GROUP_ALLOWED vazio — superfície de risco se houver qualquer exposição além da rede interna.
- Vertex desligado em runtime anula a garantia de privacidade pedida: as extrações de documentos sensíveis estão indo pelo OpenRouter por default, não pelo provider Google self-hosted pretendido.
- 'Resolver manualmente' esconde divergências sem justificativa, sem revalidar e sem recomputar o status agregado (processo nunca sai de pending_correction por resolução manual) — risco de aceite cego de erro documental sem rastreabilidade.

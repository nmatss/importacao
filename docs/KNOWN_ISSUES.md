# Known Issues

Ultima atualizacao: 2026-06-19

## CRITICO - Go-live Publico Bloqueado Por DNS/Edge/TLS

Descricao:

- O deploy operacional do SHA `3f36137a697fee9f4f1011bc3eace3417467d5be`
  concluiu em `192.168.168.124` com backup, migrations, containers e health
  interno OK.
- A URL publica `https://importacao.grupounico.com/` ainda retorna `HTTP/2 502`
  com header `server: nginx`, portanto o acesso externo nao esta apto para
  go-live.
- O Traefik compartilhado local reconhece o Host em HTTP e redireciona para
  HTTPS, mas nao possui certificado emitido para `importacao.grupounico.com`.
- A validacao ACME observada no log chegou em outro IP/proxy publico
  (`177.36.181.21`) e recebeu 404 em
  `/.well-known/acme-challenge/*`, indicando bloqueio fora do container da
  aplicacao.

Evidencias:

- `REVISION` remoto: `3f36137a697fee9f4f1011bc3eace3417467d5be`.
- `importacao-api`, `importacao-web` e `importacao-cert-api` em estado
  `healthy` no servidor.
- API interna `http://127.0.0.1:3050/health/ready` retorna `status=ok`.
- Web interna `http://127.0.0.1:8085/` retorna 200.
- Cert-api readiness passou dentro do container em `/api/ready` com
  `ready=True`.
- `curl https://importacao.grupounico.com/` retorna 502 `server: nginx`.
- HTTPS direto no Traefik por SNI falha com `tlsv1 unrecognized name`; nao ha
  entrada de `importacao.grupounico.com` em `/letsencrypt/acme.json`.

Impacto:

- Usuarios externos continuam sem acesso confiavel pela URL oficial, apesar de
  a aplicacao estar saudavel internamente.
- O sistema nao deve ser declarado em go-live publico ate o dominio responder
  200 em HTTPS e uma chamada API autenticavel via dominio publico funcionar.

Status:

- Aberto. Requer escolher e concluir uma rota:
  1. Fazer DNS/NAT/proxy encaminhar `importacao.grupounico.com` nas portas
     80/443 para o Traefik do servidor `192.168.168.124`, sem interceptar ACME.
  2. Ou configurar o nginx/edge externo como dono do TLS e proxy reverso para
     `http://192.168.168.124:8085` ou para o Traefik interno.

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

## ALTO - SYDLE Aguardando Contrato Externo Para Sync Real

Descricao:

- O modulo interno de compras/pagamentos SYDLE foi implementado, mas o
  repositorio nao possui URL, credencial, endpoint ou payload real do projeto
  SYDLE.
- Enquanto `SYDLE_SYNC_ENABLED=false` ou faltarem `SYDLE_BASE_URL` /
  `SYDLE_API_TOKEN`, o job de 15 minutos registra `status=skipped`.
- Em 2026-06-19 foram mitigados riscos internos: cursor por `sourceUpdatedAt`
  com overlap, lock transacional de sync, rotas restritas a admin, redaction de
  `raw_payload`, export CSV paginado, ID externo derivado de referencias de
  negocio e match por todos identificadores conhecidos.
- O relatorio operacional esta disponivel para administradores em
  `/importacao/compras-pagamentos` e no menu `Importacao > Operacional >
Compras/Pagamentos SYDLE`, mas a sincronizacao real permanece desabilitada.
- `scripts/deploy.sh` aborta se `SYDLE_SYNC_ENABLED=true` no `.env` remoto,
  salvo rollout aprovado com `ALLOW_SYDLE_SYNC_DEPLOY=1`.

Evidencias:

- `docs/SYDLE-INTEGRATION.md`
- `apps/api/src/modules/sydle`
- `apps/web/src/features/sydle-payments/SydlePaymentsPage.tsx`

Impacto:

- A tela e o relatorio funcionam, mas permanecem sem dados reais ate a
  configuracao da fonte SYDLE.
- O risco restante e externo: sem contrato/payload real nao ha garantia sobre
  nomes de campo, semantica de status, cursor/paginacao oficial e timezone.
- Para go-live com dados financeiros reais, isto e bloqueador externo critico:
  exige contrato/API/exportacao oficial, identificador estavel de pagamento,
  credenciais reais e UAT financeiro com amostra conciliada.

Status:

- Aberto. Requer contrato/API/exportacao real da SYDLE, identificador estavel de
  pagamento, payload sanitizado, credenciais em SOPS e teste de UAT com amostra
  conciliada pelo financeiro.

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

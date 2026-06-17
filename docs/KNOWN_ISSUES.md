# Known Issues

Ultima atualizacao: 2026-06-17

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

## ALTO - Destinatarios Operacionais De Email Ausentes Em Producao

Descricao:

- Producao sobe com warnings para `KIOM_EMAIL`, `FENICIA_EMAIL` e `ISA_EMAIL`
  ausentes.
- `communicationService.send` bloqueia envio quando `recipientEmail` esta vazio.

Evidencias:

- Logs pos-deploy de 2026-06-17 em `importacao-api`.
- `apps/api/src/server.ts`
- `apps/api/src/modules/communications/service.ts`
- `docs/STATUS-2026-06-16.md`

Impacto:

- Emails de correcao para KIOM, envio real para Fenícia e fluxo ISA podem gerar
  rascunhos sem destinatario e falhar no envio ate que os enderecos reais sejam
  configurados em `.env.sops.yaml`.

Status:

- Aberto. Requer confirmacao dos enderecos operacionais reais antes de atualizar
  secrets de producao.

## MEDIO - Validacao Usa `ohbl` Como BL Principal

Descricao:

- `runAllChecks` monta `blData` a partir de documento `ohbl`; `draft_bl` tem fluxo proprio e nem sempre substitui OHBL ausente.

Evidencias:

- `apps/api/src/modules/validation/service.ts`
- `apps/api/src/modules/documents/service.ts`

Impacto:

- Processo com Draft BL antes do OHBL pode ter validacoes incompletas.

Status:

- Aberto. Precisa definir regra operacional para Draft BL como fallback ou trilha separada.

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

- Aberto.

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

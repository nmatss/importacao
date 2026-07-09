# Status 2026-07-09 - Feedback Odett Operacional

## Objetivo

Responder aos pontos operacionais enviados por Odett sobre e-mails/atendimentos,
comparativo documental, DUIMP/registro aduaneiro e relatório SYDLE.

## Alteracoes

- Atendimentos:
  - Processo pesquisavel/editavel no menu Atendimentos.
  - Modelos de atendimento criaveis/editaveis/desativaveis em Configuracoes >
    Modelos, acessiveis por usuarios autenticados.
  - Anexos de documentos do processo em comunicacoes.
  - Rascunhos editaveis no menu e dentro do processo antes do envio.
  - Copia fixa configuravel por `COMMUNICATION_DEFAULT_CC` ou setting
    `default_cc_email`.
- E-mails recebidos:
  - `email_ingestion_logs.body_text` para novas mensagens.
  - Aba E-mails expansivel com corpo e anexos.
- Processo:
  - Faixa superior fixa com observacao urgente vermelha.
  - Tipos documentais `draft_duimp` e `duimp`.
  - Campos de registro aduaneiro: valor aduaneiro, dolar de registro, seguro,
    DUIMP, data de registro, desembaraco e canal RFB.
  - Aba Registro com conferencia processo x Draft DUIMP/DUIMP Final por aliases
    extraidos; DUIMP final tem prioridade visual sobre o draft.
  - Aba Etapas para etapas especificas por processo, com posicao e conclusao.
  - Aba Erros/Custos para registrar erros documentais e custos extras.
- Comparativo:
  - Aba passa a focar o quadro consolidado, sem checklist grande no topo.
  - Checks gerais ruidosos ocultados do quadro geral.
  - Quadro geral editavel por coluna com auditoria, evento e mensagem
    `Editado por`.
  - Matching de item usa codigo canonico extraido de codigo/descricao.
  - Comparativo por item inclui fabricante e proporcao peso bruto/liquido.
  - Quadro dedicado de fabricantes compara INV, PL e Espelho.
  - Invoice passa a capturar `manufacturerAliases` quando houver lista de
    apelidos/rodape; comparativo mostra rodape da Invoice x fornecedores do
    Espelho.
  - NCM compara prefixos de 4 digitos do OHBL com NCMs do Espelho.
- Ingestao:
  - Gmail usa `global@grupounico.com` como mailbox compartilhado padrao quando
    `GMAIL_SHARED_MAILBOX` nao estiver definido.
- Relatorio SYDLE:
  - Processo usa fallback para `Número Invoice` quando a origem nao tem processo.
  - UI sinaliza `PI`/`INV`.
  - `paidAt`, status, pago e saldo deixam de usar finalizacao do ticket e passam
    a usar dados da parcela em `paymentData`.

## Banco De Dados

- Migration adicionada: `apps/api/drizzle/0022_odett_operational_feedback.sql`.
- Campos novos:
  - `email_ingestion_logs.body_text`
  - `import_processes.urgent_note`
  - `import_processes.customs_value`
  - `import_processes.registration_dollar`
  - `import_processes.duimp_number`
  - `import_processes.registered_at`
  - `comparison_field_overrides`
  - `process_custom_stages`
  - `process_operational_records`
  - `communication_templates`
- Enum `document_type`: `draft_duimp`, `duimp`.

## Riscos E Observacoes

- Corpo completo de e-mail so aparecera para mensagens ingeridas apos aplicar a
  migration e subir o codigo; logs historicos permanecem sem `body_text`.
- A copia fixa de e-mail precisa estar configurada em settings/env para entrar
  nos envios.
- Pagamento SYDLE por parcela depende de a origem enviar data/status/valor pago
  em `paymentData`; se o campo nao vier, a parcela permanece aberta por design.
- Conferencia DUIMP e aliases de rodape dependem dos campos realmente extraidos
  dos documentos; documentos reais podem exigir novos aliases de parser.

## Pendencias Registradas

- Refinos especificos do processo real `PK2052602TJ` que dependem de fixtures
  reais anonimizadas e regras finais de extracao.
- Base mestre opcional de fornecedores/fabricantes, caso a conferencia por
  aliases extraidos da Invoice nao baste.
- Validacao DUIMP pode precisar de novos aliases depois de testar Draft DUIMP e
  DUIMP reais anonimizados.

## Testes

- `npm run typecheck` -> passed.
- `npm test -w apps/api -- sydle validation documents` -> 31 files / 282 tests passed.
- `npm test -w apps/web -- SydlePaymentsPage DocumentComparison DocumentList DocumentUpload` -> 4 files / 25 tests passed.
- `npm run lint` -> passed.
- `npm test` -> API 765 passed / 1 skipped; Web 115 passed.
- `npm test -w apps/api -- sydle` -> 4 files / 49 tests passed apos ajuste
  final de status.
- `npm run build` -> passed.
- `git diff --check` -> passed.

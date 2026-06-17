# Revisao Completa da Importacao - Workflow

Data: 2026-06-17

## Objetivo

Revisar o modulo de importacao ponta a ponta: criacao de processo, Pre-Cons/espelho,
upload e leitura de arquivos, extracao de invoice, validacao, geracao de espelho,
follow-up, interface operacional e auditoria.

## Times

### Time 1 - Arquitetura e Contratos

Responsabilidade: garantir que frontend, API, banco e jobs falem o mesmo contrato.

Escopo:

- Rotas `processes`, `documents`, `validation`, `espelhos`, `follow-up`, `pre-cons`.
- Tipos `ImportProcess`, `Document`, enums de documento/status e schemas Zod.
- Estados `status`, `logisticStatus`, milestones de `followUpTracking`.

Entregas:

- Mapa de contrato por endpoint.
- Lista de contratos quebrados.
- PRs pequenos para alinhar schema, UI e rotas.

Riscos ja identificados:

- UI alterava `logisticStatus` em `PATCH /api/processes/:id`, mas backend tem rota dedicada.
- Upload manual nao aceitava `proforma_invoice`, apesar de DB/backend/email suportarem.
- Regras de estado estao espalhadas entre upload, validacao, espelho, follow-up e scheduler.

### Time 2 - Leitura de Arquivos e Classificacao

Responsabilidade: garantir que todo arquivo seja classificado, validado e extraido com seguranca.

Escopo:

- `shared/middleware/upload.ts`
- `documents/service.ts`
- `email-ingestion/processor.ts`
- parsers de invoice, packing list, LI e espelho
- OCR/multimodal e fallback de IA

Entregas:

- Classificador de conteudo antes da decisao final do tipo do documento.
- Validacao de magic bytes tambem para anexos de email.
- Fallback OCR/local para PDF escaneado quando provider multimodal nao suportar PDF.
- Falha estruturada `needsReview`/`extractionFailed` quando schema nao bater.

Riscos ja identificados:

- Email valida menos que upload manual.
- Classificacao depende muito do nome do arquivo.
- Parser de Pre-Cons nao e locale-aware para numeros no formato `1.234,56`.
- `zodParse` pode aceitar payload fora de contrato quando schema falha.

### Time 3 - Invoice, Espelho e Origem dos Dados

Responsabilidade: manter a fonte dos dados clara e previsivel.

Regra operacional:

- Espelho pode preencher o card de processo antes da invoice.
- Quando invoice chegar, valores equivalentes da invoice passam a ter prioridade.
- Campos vindos do espelho aparecem em amarelo.
- Campos vindos da invoice aparecem em verde.
- Campos manuais/sistema ficam neutros.

Campos do card:

- Exportador
- Importador
- Porto Embarque
- Porto Destino
- Incoterm
- Valor FOB
- Frete
- Caixas
- Peso Liquido
- Peso Bruto
- CBM
- Container
- Data Embarque
- Enderecos
- Logistica quando houver espelho/processo

Entregas:

- UI com badge por fonte.
- Politica persistida de fonte por campo em backlog: `source`, `sourceDocumentId`,
  `sourceVersion`, `generatedBy`, `generatedAt`.
- Auto-espelho nao pode ficar bloqueado por um espelho enviado que falhou no parser.

### Time 4 - Validacao, Comparativo e Decisoes

Responsabilidade: transformar dados extraidos em decisoes operacionais auditaveis.

Escopo:

- `validation/service.ts`
- checks de pesos, FOB, frete, portos, datas, NCM, itens e pagamento
- comparativo INV/PL/BL/Espelho
- aceite manual e historico

Entregas:

- Matriz de severidade por campo: critico, secundario, informativo.
- Mensagens acionaveis por divergencia.
- Regras de aceite manual com nota obrigatoria.
- Historico de mudanca por reprocessamento e aceite.

### Time 5 - UX Operacional

Responsabilidade: deixar claro o que veio de onde e o que precisa de acao.

Escopo:

- `ProcessInfoCard`
- `DocumentUpload`
- `DocumentList`
- `DocumentComparison`
- tabs de Pre-Cons, Proformas, Espelho, Follow-Up e Historico

Entregas:

- Badges de fonte no card.
- Proforma disponivel no upload manual.
- Estados de erro/reprocessamento evidentes.
- Checklist com proximas acoes por pendencia.

## Fluxo Completo

1. Processo nasce manualmente, por Pre-Cons ou por email.
2. Sistema cria `import_processes` e `follow_up_tracking`.
3. Documento entra por upload manual ou email.
4. Arquivo passa por validacao de tipo, tamanho e conteudo.
5. Sistema classifica o documento por conteudo e nome.
6. Documento e salvo em `documents`.
7. Extracao roda:
   - espelho: parser deterministico XLSX; fallback IA apenas quando habilitado e seguro;
   - invoice/PL/BL: parser deterministico quando possivel, depois IA;
   - PDF escaneado: multimodal; backlog para OCR local.
8. Resultado bruto fica no documento.
9. Resultado flatten fica em `importProcesses.aiExtractedData` por tipo.
10. Card de processo projeta a melhor fonte:
    - invoice vence;
    - espelho preenche enquanto invoice nao chegou;
    - processo/manual fecha fallback.
11. Validacao roda parcialmente quando faltar algum core doc e completa com INV + PL + BL.
12. Auto-espelho roda com INV + PL + BL, desde que nao exista espelho pendente ou valido.
13. Comparativo mostra divergencias por campo e item.
14. Operador corrige, aceita com justificativa ou reprocesa documento.
15. Follow-up e milestones avancam.
16. Historico e auditoria registram upload, extracao, reprocessamento, aceite e geracao.

## Criterios de Aceite

- Card nao deve mostrar `---` quando houver dado confiavel no espelho.
- Ao chegar invoice, campos presentes nela devem trocar para badge verde `Invoice`.
- Campos apenas do espelho ficam com badge amarelo `Espelho`.
- Upload manual deve permitir Proforma.
- Espelho com parse falho nao pode impedir auto-espelho quando INV + PL + BL existem.
- Testes de UI cobrem prioridade invoice > espelho > processo.
- Typecheck e testes relevantes passam antes de entrega.

## Backlog Priorizado

P0:

- Corrigir origem visual no card de processo.
- Liberar Proforma no upload manual.
- Desbloquear auto-espelho quando o espelho enviado falhou no parser.

P1:

- Persistir fonte por campo no backend.
- Validar magic bytes nos anexos de email.
- Corrigir rota de atualizacao de `logisticStatus` na UI ou backend.
- Tornar parser Pre-Cons locale-aware.

P2:

- Classificador de conteudo antes da classificacao final.
- OCR local/conversao imagem para PDFs escaneados.
- Contrato estrito de schema de extracao com `needsReview`.
- Unificar a fonte de verdade entre `documents.aiParsedData` e `importProcesses.aiExtractedData`.

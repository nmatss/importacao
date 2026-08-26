# ADR 0006 — Fonte canônica dos itens documentais

**Data**: 2026-08-26
**Status**: Aceito

## Contexto

Itens de Invoice, Packing List e espelho aparecem hoje em duas representações:

- o payload versionado da extração em `documents.ai_parsed_data` e sua projeção
  em `import_processes.ai_extracted_data`;
- `process_items`, criada pelo fluxo legado de geração/edição de espelho.

A reconciliação de 2026-08-26 encontrou zero linhas em `process_items`, embora
documentos possuam arrays de itens extraídos. Popular a tabela cegamente usaria
a primeira Invoice encontrada, poderia escolher versão histórica, duplicar itens
e perder a ligação com o documento/extraction run que originou cada valor.

## Decisão

O payload do documento vigente e sua linhagem são a **fonte canônica da
extração**. `process_items` permanece uma **projeção operacional editável e
opcional**, materializada somente quando o fluxo de espelho exigir edição
tabular.

Consequências operacionais:

- zero linhas em `process_items` não significa ausência de itens extraídos;
- relatórios de completude devem inspecionar o array `items` do documento
  vigente e informar separadamente se há projeção editável;
- nenhum backfill de `process_items` será executado até existir upsert
  idempotente por versão canônica com `source_document_id`,
  `extraction_run_id` e hash da fonte;
- reprocessar ou reclassificar um documento deve invalidar uma projeção antiga
  antes de reutilizá-la;
- geração de espelho deve selecionar documento vigente, processado, não falho e
  acima do piso operacional, nunca `invoiceDocs[0]` sem ordenação.

## Alternativas rejeitadas

### Popular `process_items` imediatamente a partir de todos os JSONs

Rejeitada porque não há chave de idempotência nem origem por linha. Duplicaria
ou misturaria versões em processos com mais de uma Invoice.

### Tornar `process_items` a fonte original da extração

Rejeitada porque perderia o payload imutável, confiança, provider, parser e
evidência por campo preservados na linhagem documental.

## Impacto e trabalho futuro

Uma futura materialização deverá ser migration incremental e incluir:

- `source_document_id` e `extraction_run_id`;
- chave única por processo, execução e identidade normalizada do item;
- substituição transacional e auditada;
- dry-run e relatório de diff;
- invalidação explícita após nova extração;
- testes com Invoice duplicada, baixa confiança, FOC e itens sem código.

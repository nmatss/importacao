# Status 2026-07-10 — Auditoria Profunda de Análise Documental

## Objetivo

Revisar o caminho completo de documentos: upload e e-mail, classificação,
extração, confiança, projeção no processo, comparativo, validação, auditoria,
segurança e operação.

## Diagnóstico e evidências

O pipeline observado é: upload/e-mail → validação do arquivo → documento
persistido → fila `ai-extraction` → parser determinístico/IA → harness de
confiabilidade → linhagem e projeção atômica no processo → validação e
comparativo. As fontes principais são `documents/service.ts`,
`email-ingestion/processor.ts`, `ai/service.ts`, `validation/` e a UI de
documentos.

Controles já presentes:

- Upload limita tamanho e valida magic bytes; conteúdo HTML é sempre entregue
  como download, sem renderização ativa.
- Anexos de e-mail validam tamanho e assinatura do conteúdo, têm hash SHA-256,
  deduplicação por processo e linhagem recuperável.
- A fila pg-boss torna a extração resiliente a reinício; há timeout operacional,
  alerta de falha e degradação explícita quando faltam documentos centrais.
- Extrações abaixo de 40% ficam como evidência e não alimentam validação,
  espelho ou projeção operacional. O harness reduz confiança em dados sem
  evidência/consistência suficiente.
- Escritas concorrentes em `ai_extracted_data` usam merge JSONB atômico.
- Há histórico de extração, aceite de comparativo invalidável e linhagem de
  campos para extrações novas.

## Correções implementadas nesta revisão

- Reclassificação auditável de documento por operador: preserva a extração
  anterior, invalida aceites derivados, reconstrói a projeção, registra evento
  e reinicia o parser correto.
- Reprocessamento e correção de classificação ficam disponíveis a analistas;
  exclusão permanece administrativa.
- A origem de documento passa a usar a relação direta
  `email_attachment_documents.document_id`, em vez de inferir pelos últimos
  logs/nome de arquivo. Isso evita falsa origem para anexos antigos ou nomes
  repetidos.
- Lease distribuída por `document_id`: o worker reivindica o documento por
  `UPDATE` condicional antes de OCR/IA; entrega duplicada não executa o parser
  e uma lease expirada pode ser recuperada após queda do worker. A migração
  `0024_document_analysis_hardening.sql` deve ser aplicada antes do deploy.
- Corpus sintético, versionado e seguro (INV, PL, OHBL e DUIMP) passa a cobrir
  o runner de avaliação no CI. O score também reprova campos inesperados como
  alucinação, em vez de avaliar somente as chaves presentes no gold.

## Riscos remanescentes

| Prioridade | Risco                                                                                                               | Ação recomendada                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| BAIXO      | OCR local para PDF escaneado exige Poppler/Tesseract e packs `por`/`eng` instalados no container antes da ativação. | Validar binários no ambiente e ativar gradualmente `DOCUMENT_OCR_ENABLED=1`; falhas usam fallback multimodal. |
| MÉDIO      | A lease tem expiração configurável; extrações que excederem a janela podem ser retomadas.                           | Monitorar duração p99 e configurar `DOCUMENT_EXTRACTION_LEASE_MS` acima dela; o mínimo aceito é 2 min.        |
| MÉDIO      | O corpus de CI é sintético; ainda não há layouts reais anonimizados aprovados pelos responsáveis.                   | Adicionar casos ouro INV/PL/OHBL/DUIMP/Espelho por fornecedor/layout, sem PII, antes de promover modelo.      |
| MÉDIO      | Linhagem persiste hash e campos, mas normalmente não informa página/trecho de evidência.                            | Persistir página, bounding box/trecho e versão de parser por campo.                                           |
| MÉDIO      | PDF/planilha de até 50 MB pode gerar payload multimodal grande e timeout.                                           | Limitar páginas/imagens, pré-processar e registrar tamanho/páginas/tempo.                                     |
| BAIXO      | Upload de formatos amplos (DOC/EML/imagens) não possui extratores especializados por tipo documental.               | Priorizar conforme volume real; manter reclassificação e alerta até então.                                    |

## Segurança

Não foram identificados vetores novos de path traversal, XSS de preview ou
anexo de e-mail sem validação no caminho auditado. O principal risco de dados é
qualidade de extração, não autorização: todas as ações documentais continuam
atrás de autenticação e processo travado bloqueia alteração.

## Testes

- API documentos: 68 testes aprovados após as novas coberturas de
  reclassificação e linhagem.
- Lease/eval: typecheck e 25 testes direcionados aprovados, incluindo entrega
  duplicada que não chama OCR/IA e corpus sintético reproduzível.
- Web `DocumentList`: 2 testes aprovados, incluindo recuperação por analista.
- `npm run typecheck` e `git diff --check` aprovados.

## Rollout em produção — 2026-07-10

Publicado em produção nos commits `d5a7f36` e `739f63a`.

- Migração `0024_document_analysis_hardening.sql` aplicada e schema validado:
  lease em `documents` e `source_excerpt` em campos extraídos.
- Runtime validado com Poppler e Tesseract (`por` e `eng`),
  `DOCUMENT_OCR_ENABLED=1` e lease de 10 minutos.
- Mailbox persistente SOPS configurado como `global@grupounico.com`.
- Full resync da SYDLE concluído: 26 registros atualizados, zero erros.
- Oito documentos do processo real `PK2052602TJ` foram reenfileirados e a
  fila concluiu todos os jobs. Cinco extrações concluíram normalmente; três
  invoices ficaram explicitamente em falha para revisão manual (resposta sem
  dados úteis ou JSON inválido), sem projeção automática.
- O teste revelou uma falha de segurança operacional: a reconciliação podia
  elevar a confiança de uma extração já marcada como falha. O commit `739f63a`
  bloqueia esse caminho e a reparação de dados reduziu essas confianças a zero.
- Pós-deploy validado: API healthy, dependências DB/Redis healthy e site
  público HTTP 200.

## Pendências de operação

As três invoices marcadas como falha no PK2052602TJ exigem reclassificação,
documento substituto ou correção manual por operador; não são evidência de
êxito da leitura. Para elevar a cobertura do CI, ainda falta incorporar
documentos reais anonimizados e aprovados como casos ouro.

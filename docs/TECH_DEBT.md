# Technical Debt

Ultima atualizacao: 2026-08-26

## Validacao E Comparativo

- Consolidar terminologia e persistencia entre aceite do checklist e aceite do comparativo documental.
- Extrair tipos/helpers duplicados de validacao para modulo compartilhado no frontend.
- Substituir/complementar a fixture representativa de `allChecks` por PDFs ou
  extracoes reais anonimizadas de INV/PL/OHBL/Draft BL quando o negocio liberar
  amostras. Em 2026-06-17 foi adicionada cobertura representativa sem mock de
  `allChecks`.
- Persistir contrato relacional para aceite do comparativo, em vez de depender apenas de evento de timeline.
- Ao revalidar, definir se aceites manuais devem sobreviver ao novo run quando a divergencia persistir. Em 2026-06-19 a validacao final passou a ter `validation_runs` canonico, mas a reutilizacao de aceite ainda precisa de politica por hash de evidencia.
- Fortalecer E2E do fluxo documental com upload multipart real, magic-byte
  negativo, preview/download, permissao admin para reprocess/delete, processo
  travado e validacao ponta a ponta usando as rotas reais.

## IA E Extracao

- Substituir o short-circuit binário dos parsers determinísticos por política
  versionada de qualidade e telemetria. O gate pontual de packing list impede
  `PHONE:` como código, mas layouts novos ainda exigem corpus anonimizado.
- Implementar chunking/continuação para invoices e packing lists tabulares
  grandes. Em 25/08 duas invoices precisaram de teto de saída e timeout maiores,
  e um packing list só acionou o Gemini após rejeitar o parser determinístico.
- Separar confiança do modelo de acurácia medida: criar amostra rotulada,
  métricas por campo/tipo e gate >=90% antes de qualquer garantia de negócio.

- Criar executor administrativo de reprocessamento em lote com dry-run,
  selecao canonica, exclusao explicita de processos, batch ID, checkpoint,
  retomada e exclusao mutua.
- O modo de manutenção agora difere validação, reconciliação, Drive, Chat e
  espelho automático. Dívida residual: separar reclassificação do enqueue e
  persistir o batch/lock global no banco.
- Tornar o limite de reprocessamento global por usuario/operacao, em vez de
  incluir o ID do documento em `req.path` como parte isolante da chave.
- Implementar rollback controlado de extracao a partir de
  `document_extraction_history`; hoje a tabela preserva evidencia, mas nao ha
  endpoint/servico de restauracao.
- `DOCUMENT_EXTRACTION_LEASE_MS` foi alinhado em 25 minutos no Compose. Dívida
  residual: medir p99 e adicionar validação fail-fast que rejeite lease menor
  que o pior timeout configurado.
- A lease/lock atomica por `document_id` foi entregue na migration `0024`; a
  divida residual e alinhar o valor efetivo de producao ao pior timeout e
  impedir lote concorrente em nivel de batch/processo.
- Evoluir linhagem de campos para evidência navegável: página, trecho/posição e
  versão efetiva do parser/modelo por campo.
- Versionar um corpus anonimizado de documentos reais e executar o evaluator de
  extração no CI antes de promover parser/modelo.
- Unificar helpers de `parseNumber`, `parseDate`, FOC e normalizacao entre parsers, harness, validation e anomalies.
- Documentar a decisao final de provider: IA local, Vertex ou estrategia hibrida.
- Revisar latencia e timeout do provider local em CPU para PDFs imagem-only:
  em 2026-06-18 a Invoice KIOM foi resolvida por parser deterministico, mas a
  chamada multimodal ao gateway local ainda pode bater `Headers Timeout Error`
  em ~300s quando realmente precisar de VLM/OCR.
- O classificador por conteúdo de anexos genéricos e o operador de triagem
  histórica foram entregues. Dívida residual: corpus rotulado, score/matriz de
  confusão e fila de aprovação humana antes de reclassificação em lote.
- Deduplicar reprocessamentos concorrentes com update condicional atomico,
  `SELECT FOR UPDATE` ou singleton por `documentId` na fila.

## Banco E Dados

- Separar definitivamente o indicador histórico de correção da planilha do
  estado de workflow. O importador agora preserva
  `sheetDocumentCorrection` no JSON, mas falta uma coluna tipada ou tabela de
  origem por campo.

- Criar documento de indices por tabela e queries criticas.
- Auditar indices redundantes e queries com risco de full scan.
- Sydle: obter catalogo/permissao ou view/API consolidada para dados
  financeiros sensiveis de compra/pagamento internacional. As colunas
  operacionais do relatório Analytics/CSV foram adicionadas ao staging em
  2026-07-08; cambio/banco/remessa ainda dependem de acesso sanitizado.
- Avaliar historizacao e origem por campo para dados projetados no card do processo.
- Padronizar query keys do frontend com `processKeys`, `documentKeys`, `followUpKeys` e equivalentes de validacao.
- Unificar cache de `/api/documents/process/:id/comparison` entre comparativo e Draft BL.
- Avaliar invalidação granular de aceite manual/comparativo derivado quando
  `aiExtractedData` for reconstruído por delete/reprocessamento de documento.

## DevOps E Operacao

- Expor `APP_VERSION`/revision real no health de producao e registrar o SHA em
  todo batch operacional.
- Adicionar runbook especifico para reprocessamento documental: backup de banco
  e `uploads`, piloto, pausa, criterios de encerramento e reconciliacao de
  efeitos externos.
- Completar o ambiente E2E descartável para Gmail API/Drive/Odoo. PostgreSQL,
  SMTP e IMAPS já usam Testcontainers + GreenMail com PDF, envio pela API,
  flags de leitura e leases de idempotência; Gmail API, Drive, scheduler e Odoo
  ainda não possuem emulador/fixture integrado.
- Adicionar chave operacional para suprimir notificacoes e uploads externos em
  manutencoes controladas, sem desligar silenciosamente integracoes normais.
- Corrigir warnings conhecidos do script de backup para volumes ausentes.
- Adicionar alerta externo para falha do `scripts/restore-test.sh` e medir RTO em
  execucao recorrente. Restore manual e cron semanal validados em 2026-06-17.
- Evoluir autorizacao fina do proxy `/cert-api/`: em 2026-06-20 o Nginx passou
  a exigir admin via `/api/auth/cert-api-access` antes de injetar `X-API-Key`.
  Ainda falta separar escopos como `cert.read`, `cert.write`, `cert.sync` e
  `cert.admin` quando o negocio definir usuarios leitores/escritores.
- Formalizar frescor minimo do estoque: o relatorio `Estoque Detalhado` exporta
  o cache `cert_stock`; se `/api/sync-stock` falhar parcialmente, WMS e
  e-commerce podem ter timestamps diferentes. Em 2026-06-19 o XLSX passou a
  expor `Sincronizado em`, mas ainda falta politica/SLA de bloqueio por dado
  velho.
- Adicionar gate de volume/queda anormal ao replace de estoque. WMS e e-commerce
  ja usam `DELETE + INSERT` transacional desde `e243ca2`, portanto removem SKU
  ausente; a divida atual e impedir que uma resposta vazia ou truncada, mas sem
  excecao, substitua um snapshot saudavel inteiro.
- **Resolvido em 2026-08-26:** os seis advisories moderados foram eliminados.
  React Router 7.18.2 passou na regressão de rotas; no tooling, o loader
  `@esbuild-kit` abandonado foi substituído por `tsx`, conforme a própria
  depreciação upstream. `npm ci`, audit completo e `drizzle-kit check` passaram.
- Criar probe sintetico de egress externo da API e alerta por sequencia de
  falhas de cron. O incidente de 01-14/08/2026 rodou 1.864 falhas seguidas do
  `sydle-sync` em 12 dias com `/health/ready` verde; o detector foi o usuario
  final. Sinal barato e disponivel: `sydle_sync_runs` com N falhas consecutivas
  e nenhum sucesso na janela. Nao usar readiness bloqueante para dependencia de
  terceiro — reiniciar a API nao corrige queda externa.
- Adicionar validacao de rota default no pos-deploy: conferir que a saida da API
  nao caiu em `ia-local-net`. O deploy de 07/08/2026 passou nos 8 health checks
  com o container sem nenhuma saida para a internet. O `gw_priority` no compose
  previne, mas nada verifica.
- Fazer o `authController` logar o motivo real do erro de login com correlation
  ID. Hoje o motivo so aparece quando passa pelo `googleGroupsService`; falha em
  `verifyIdToken` nao deixa rastro no log, so o status HTTP.
- Fechar a causa raiz do bloqueio do IP `192.168.208.4` na `ia-local-net`
  (`docs/KNOWN_ISSUES.md`). O `gw_priority` contorna o caminho, nao remove a
  regra.

## Frontend

- Migrar modais especificos restantes de Settings e Agendamentos para Dialog
  compartilhado com foco inicial, trap, Escape, `aria-describedby` e restore
  focus. Modal de e-mail de correcao foi coberto em 2026-06-17; `ConfirmDialog`
  compartilhado foi coberto em 2026-06-18.
- Fortalecer formularios de Settings, Communications e CertCadastro com Zod/RHF,
  erros por campo, trim, validacao de URL/e-mail/porta/PDF e testes de conexao
  quando aplicavel.
- Criar experiencia mobile dedicada para tabelas largas e kanban operacional
  (cards por breakpoint, colunas prioritarias ou acordeoes), especialmente
  Cert Produtos, Pre-Cons, Email Ingestion e Follow-Up.
- Decidir se o checklist de Draft BL vira entidade auditavel ou permanece como anotacao local.

## Documentos, IA E E-mail Ingestion

- OCR local para PDFs escaneados foi entregue com Poppler+Tesseract opt-in,
  limite de páginas/tempo, métricas e fallback multimodal. A operação ainda
  precisa instalar os binários e idiomas no container antes de ativar
  `DOCUMENT_OCR_ENABLED=1`; screenshots/imagens seguem pelo multimodal.

Concluido em 2026-06-24:

- Linhagem relacional de extração em `document_extraction_runs` e
  `document_extracted_fields`, incluindo `document_id`, `field_path`, valor,
  confiança, hash do texto fonte, provider/modelo e versão de parser.
- Evidência por campo na extração mais recente: página inferida de forma
  determinística quando o valor ocorre no texto e trecho limitado a 500
  caracteres, disponível em `GET /api/documents/:id/extraction-evidence`.
- Deduplicação de anexos de e-mail em `email_attachment_documents` por
  `process_id + content_sha256`, com origem, caminho local, Drive inbox,
  documento vinculado e estado de órfão/recuperável.
- Aceite de comparativos em `comparison_acceptances`, com escopo, linha/campo,
  hash de evidência, usuário, nota e invalidação quando há nova extração.
- Classificação textual de anexos PDF/XLSX genéricos antes de marcar como
  `other`.

Concluido em 2026-06-18:

- Ordenacao acessivel na tabela de Produtos de Certificacoes com botoes focaveis
  e `aria-sort`.
- Estados acessiveis (`aria-pressed`, `role="switch"`, `aria-checked` e menu de
  tema) nos filtros/toggles visuais revisados.
- Upload de documentos acessivel com validacao client-side de extensao/tamanho e
  progresso semantico.
- Upload/reprocess/delete de documentos respeitam processo travado; extracoes
  com confianca menor que 40% ficam como evidencia, sem projecao operacional
  para validacao/espelho; comparativo e validacao usam documento vigente,
  processado, nao falho e acima do piso de confianca.
- Extrações processadas sem dado útil deixaram de contar como documento lido e
  novas respostas vazias da IA passam a virar falha de extração com alerta.
- Filas `pg-boss` agora sao criadas idempotentemente no boot da API antes de
  enviar jobs, evitando `ai-extraction` silenciosamente descartado por fila
  inexistente.
- Parser deterministico de Invoice cobre o layout compacto KIOM com campos e
  itens colados, total FOB, portos, data `CI DATE` e FREE OF CHARGE recorrente.
- Runbook/README reconciliados com `AI_PROVIDER=ialocal`, egress externo por
  opt-in e rollback rsync/snapshot sem `git checkout` no servidor.
- Rotas internas invalidas com fallback contextual em Importacao/Certificacoes.
- Linhas navegaveis por teclado nas tabelas operacionais revisadas.
- Validacao positiva/coerente em processos, cambios e cron de agendamentos.

Concluido em 2026-06-19:

- Falha de schema Zod da IA manteve fallback permissivo com downgrade explicito:
  `_trust.contractFailure` e confianca capada abaixo de 40%.
- Validacao parcial automatica deixou de executar efeitos finais; validacao
  final ganhou check `document-set-completeness`.
- `validation_runs` passou a ser entidade canonica vinculada a resultados,
  historico e correcoes.
- Historico de extracao deixou de depender de `ON DELETE CASCADE` do documento;
  delete arquiva a extracao com metadados antes da remocao.
- SYDLE mitigou riscos internos de cursor, matching, CSV truncado, acesso amplo
  e `raw_payload` sensivel.
- Relatorio de estoque detalhado passou a filtrar marca por
  `COALESCE(cp.brand, cs.brand)` normalizado, preservar WMS em filtros por marca,
  retornar erro claro para `cert-reports` sem permissao e expor `Sincronizado em`.
- Dockerfiles API/Web passaram a usar contexto raiz, manifests de workspaces e
  `npm ci --ignore-scripts` com `HUSKY=0`; E2E de documentos teve timeout local
  alinhado ao Vitest 4.

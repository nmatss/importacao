# STATUS 2026-08-03 - Reprocessamento documental integral sem o DEMO

## Objetivo Identificado

Planejar o reprocessamento de toda a base documental operacional de importacao,
excluindo integralmente o atendimento/processo de demonstracao, com selecao
canonica, auditoria, rollback e validacao mensuravel.

Esta rodada foi somente leitura. Nenhuma linha do banco, arquivo, fila,
configuracao, integracao externa ou estado de producao foi alterado.

## Identificacao Do DEMO

O atendimento de demonstracao foi identificado de forma inequivoca:

| Campo                   | Valor                      |
| ----------------------- | -------------------------- |
| `process_id`            | `264`                      |
| `process_code`          | `DEMO-IM0712602NB-E227210` |
| Status                  | `validating`               |
| Documentos              | 11                         |
| Atendimentos vinculados | 27                         |

A exclusao operacional deve usar `process_id <> 264`. Nao usar busca textual
por `demo` em assunto, nome de arquivo ou corpo de atendimento como criterio
primario, pois isso e mais fragil e pode excluir registros reais por engano.

Grau de confianca: alto, medido diretamente no PostgreSQL de producao em
2026-08-03.

## Diagnostico Executivo

**Decisao: NO-GO para disparar o lote pelas rotas unitarias existentes.**

A capacidade basica esta disponivel: fila vazia, zero leases ativas, todos os
arquivos locais presentes, Vertex ativo, OCR ativo e espaco em disco
suficiente. Entretanto, o fluxo atual nao possui orquestrador de lote e cada
reprocessamento pode produzir efeitos derivados no workflow, validacao, Google
Drive e Google Chat.

O lote seguro exige antes:

1. executor administrativo com dry-run, batch ID, retomada e selecao canonica;
2. modo de manutencao para diferir validacao, Drive e alertas;
3. lease alinhada ao timeout maximo do job;
4. classificacao dos documentos `other` e correcao dos espelhos PDF;
5. backup novo do PostgreSQL e do volume `uploads`;
6. piloto real antes da execucao integral.

## Inventario De Producao

Medicao realizada em 2026-08-03, sem escrita:

| Metrica                                               | Quantidade |
| ----------------------------------------------------- | ---------: |
| Processos totais                                      |        274 |
| Processos sem DEMO                                    |        273 |
| Processos sem DEMO com documentos                     |         25 |
| Documentos sem DEMO                                   |        121 |
| Arquivos fisicamente disponiveis                      |    121/121 |
| Documentos processados                                |         99 |
| Documentos pendentes                                  |         22 |
| Documentos tipados como extraiveis, incluindo espelho |         95 |
| Documentos `other`                                    |         26 |
| Processos com documentos canonicos extraiveis         |         21 |
| Jobs em `pgboss.job`                                  |          0 |
| Leases ativas                                         |          0 |
| Documentos em processos travados                      |          0 |
| Aceites de comparativo ativos fora do DEMO            |          0 |

Distribuicao atual dos 121 documentos:

| Tipo         | Total | Processados | Pendentes | Com dados | Sem dados |
| ------------ | ----: | ----------: | --------: | --------: | --------: |
| Invoice      |    63 |          63 |         0 |        56 |         7 |
| Packing List |    15 |          15 |         0 |        11 |         4 |
| OHBL         |     7 |           7 |         0 |         7 |         0 |
| Draft BL     |     5 |           5 |         0 |         5 |         0 |
| Espelho      |     5 |           2 |         3 |         2 |         3 |
| Other        |    26 |           7 |        19 |         7 |        19 |

## Duplicidade E Selecao Canonica

Foram encontrados 28 grupos duplicados de `processo + tipo`, envolvendo 101
documentos e 73 versoes excedentes. Reprocessar todas as versoes faria
documentos historicos competirem com a versao operacional atual.

A regra canonica proposta e:

```text
PARTITION BY process_id, effective_document_type
ORDER BY created_at DESC NULLS LAST, id DESC
```

Antes da revisao de `other`, existem 40 documentos canonicos:

| Tipo         | Canonicos |
| ------------ | --------: |
| Invoice      |        18 |
| Packing List |         7 |
| OHBL         |         6 |
| Draft BL     |         4 |
| Espelho      |         5 |
| Total        |        40 |

Status dos 21 processos canonicos afetados:

| Status       | Processos | Documentos canonicos |
| ------------ | --------: | -------------------: |
| `draft`      |        11 |                   13 |
| `validating` |         6 |                   21 |
| `validated`  |         3 |                    5 |
| `completed`  |         1 |                    1 |

O processo `completed` precisa de tratamento separado: a state machine nao
permite `completed -> validating`, logo a extracao pode terminar enquanto a
revalidacao automatica falha por transicao invalida.

## Triagem Dos Documentos `other`

O classificador de filename implantado em producao foi executado em modo
somente leitura sobre os 26 documentos `other`:

| Classificacao sugerida | Documentos | Processos |
| ---------------------- | ---------: | --------: |
| `proforma_invoice`     |          6 |         1 |
| `invoice`              |          4 |         2 |
| `draft_duimp`          |          1 |         1 |
| Continua `other`       |         15 |         6 |

As 11 sugestoes precisam de confirmacao humana. A rota atual de
reclassificacao tambem reprocessa automaticamente; portanto, nao deve ser usada
em massa antes de existir um modo que separe correcao de metadado e enqueue.

Depois de simular essas reclassificacoes, sem persisti-las, o universo canonico
fica:

| Tipo efetivo     | Canonicos |
| ---------------- | --------: |
| Invoice          |        20 |
| Packing List     |         7 |
| OHBL             |         6 |
| Draft BL         |         4 |
| Proforma Invoice |         1 |
| Draft DUIMP      |         1 |
| Espelho          |         5 |
| Total            |        44 |

Dos 5 espelhos, 3 sao XLSX processaveis e 2 sao PDF. O parser de espelho atual
e deterministico para planilha; `ESPELHO_AI_FALLBACK` nao esta habilitado. Os 2
PDFs nao devem entrar no lote ate serem substituidos por XLSX, reclassificados
ou receberem suporte explicito.

Assim, o lote executavel planejado tem **42 documentos canonicos**:

- 39 extracoes via IA;
- 3 espelhos XLSX;
- 21 processos;
- DEMO `264` excluido;
- 15 `other` inconclusivos fora do lote, pendentes de triagem;
- 2 espelhos PDF fora do lote, pendentes de correcao de dado/formato.

## Qualidade Atual

Na selecao canonica anterior as reclassificacoes simuladas:

- 5 documentos possuem marcador explicito de falha de extracao;
- 10 documentos estao abaixo de 40% de confianca, com sobreposicao com as
  falhas explicitas;
- ha 10 documentos core em XLSX, que precisam ser confirmados como planilha
  real e nao screenshot/conteudo inadequado;
- o maior arquivo tem aproximadamente 2 MB; nenhum supera 15 MB;
- todos os 121 caminhos locais foram validados como existentes no container da
  API;
- nenhum documento possui `drive_file_id` persistido atualmente.

"100% operacional" deve significar que cada documento canonico termina em um
estado terminal auditavel:

- extraido e utilizavel; ou
- falho/quarentenado, com causa e acao operacional explicitas.

Nao significa forcar todos os documentos a ficarem verdes ou acima do piso de
confianca.

## Arquitetura Do Reprocessamento Atual

Fluxo existente:

```text
POST /api/documents/:id/reprocess
  -> valida processo nao travado
  -> arquiva ai_parsed_data anterior
  -> limpa extracao e reconstrui aiExtractedData do processo
  -> registra auditoria
  -> envia job ai-extraction
  -> worker batchSize=1
  -> OCR/parser/Vertex
  -> persiste linhagem e confianca
  -> invalida aceites
  -> atualiza projecao do processo
  -> roda validacao parcial/final
  -> reconcilia confianca
  -> pode subir arquivo/relatorio no Drive e emitir alertas
```

Pontos positivos comprovados:

- historico anterior e gravado antes da limpeza, na mesma transacao;
- fila tem `retryLimit=2`, backoff e expiracao de 25 minutos;
- worker opera com `batchSize=1`;
- lease por documento evita duplicacao dentro de sua janela;
- arquivos faltantes foram descartados como bloqueador nesta base;
- aceites ativos nao sao bloqueador atual porque a contagem e zero.

Lacunas para lote:

- nao existe endpoint/job de reprocessamento em massa;
- nao existe batch ID ou retomada;
- chamadas diferentes nao compartilham um limitador global efetivo, pois a
  chave do rate limiter inclui `req.path`;
- o documento e limpo antes de aguardar sua vez no worker;
- reclassificacao e reprocessamento estao acoplados;
- validacao e executada depois de cada documento, em vez de uma vez por
  processo ao fim do lote;
- Drive e Chat nao possuem modo de supressao para manutencao;
- nao existe endpoint de restauracao do historico arquivado.

## Banco De Dados E Rollback

O banco de producao media aproximadamente 55 MB e havia cerca de 602 GB livres
no host. Capacidade de disco nao e bloqueador.

O historico continha 24 snapshots de extracao para 23 documentos fora do DEMO,
com aproximadamente 27 kB de payload JSONB. O reprocessamento acrescentara
snapshots, runs, campos extraidos, auditoria, eventos e validacoes.

O backup mais recente localizado era de 2026-07-17, insuficiente para uma
operacao em 2026-08-03. Antes do lote, criar e verificar:

1. `pg_dump` novo;
2. snapshot do volume `uploads`;
3. inventario de Drive/alertas no corte inicial;
4. teste de listagem/leitura do dump.

O historico relacional permite recuperar evidencia anterior, mas ainda nao ha
rollback por API. Restauracao sistemica depende de backup. Restaurar o banco
nao remove arquivos ja criados no Drive nem mensagens enviadas ao Chat; por
isso, os efeitos externos devem ser suprimidos durante o lote.

## Seguranca E Egress

Configuracao observada, sem revelar credenciais:

- `AI_PROVIDER=vertex`;
- `AI_ALLOW_EXTERNAL=true`;
- `AI_SELF_REPAIR_PAID=1`;
- `AI_MONTHLY_BUDGET_USD=200`;
- Google Drive configurado;
- Google Chat configurado;
- OCR local habilitado.

O egress documental para Vertex ja esta autorizado na configuracao de
producao. O executor de lote deve continuar admin-only, registrar usuario/batch
e nunca aceitar caminho de arquivo livre. Nenhum secret foi lido ou exposto
durante a analise.

O incidente de egress/login documentado em
`STATUS-2026-08-03-LOGIN-GOOGLE.md` precisa ser resolvido ou monitorado antes do
lote, pois o mesmo gateway instavel pode atingir Vertex e Drive.

## Performance E Custo

Na janela anterior, 18 chamadas Vertex registradas consumiram cerca de
US$ 0,11. A media observada do Flash foi aproximadamente US$ 0,0059 por chamada.
Uma extrapolacao simples das 39 extracoes canonicas sugere custo inferior a
US$ 1, mas self-repair, Pro, retries e quantidade de itens podem aumentar o
valor.

Grau de confianca da estimativa: medio-baixo, porque as chamadas antigas nao
tinham `latency_ms` preenchido e custo varia por documento.

Tempo operacional preliminar: 1 a 3 horas em execucao sequencial monitorada,
podendo aumentar com OCR ou retries. Nao usar essa estimativa como SLA ate o
piloto medir p50/p95 reais.

## Riscos

### ALTO - Efeitos externos duplicados

- Invoice reprocessada pode executar `drive.files.create` novamente.
- Cada validacao final pode criar relatorio e mover pasta.
- Alertas podem ser enviados ao Google Chat.
- Mitigacao: modo de manutencao e consolidacao por processo.

### ALTO - Workflow alterado por revalidacao automatica

- 11 processos estao em `draft` e podem mudar de estado.
- O processo `completed` nao aceita revalidacao.
- Mitigacao: diferir validacao e aplicar regra explicita por status.

### ALTO - Lease menor que o pior tempo de job

Producao esta com `DOCUMENT_EXTRACTION_LEASE_MS=600000` (10 minutos), enquanto
texto/OCR pode chegar a 20 minutos e o job expira em 25 minutos. Ajustar para no
minimo `1500000` antes do lote.

### ALTO - Versao historica pode competir com versao atual

Ha 73 versoes excedentes. Reprocessar tudo sem selecao canonica pode projetar
ou validar documento obsoleto.

### MEDIO - Ruido operacional de alertas

Nos 21 processos afetados havia 1.183 alertas abertos: 1.154 warnings, 23
criticos e 6 informativos. A validacao do lote deve filtrar por timestamp e
batch, nao por total acumulado.

### MEDIO - Revision ausente no health

O health retornou `revision: null` e `APP_VERSION=dev`. Os hashes dos fontes
criticos no servidor coincidiram com o workspace e o classificador atual foi
executado no container, mas o deploy deve expor o SHA real para auditoria.

### BAIXO - Custo e armazenamento

O teto mensal e o espaco em disco sao suficientes para o lote planejado.

## Plano De Execucao

### Fase 0 - Correcao tecnica

- Criar executor admin-only com `--dry-run`, `--canonical-only`,
  `--exclude-process-id 264`, batch ID e retomada.
- Impedir duas execucoes simultaneas.
- Separar reclassificacao de enqueue no modo de manutencao.
- Diferir validacao, Drive, Chat e geracao de relatorio.
- Ajustar lease para 25 minutos.
- Expor revision/SHA no health.

### Fase 1 - Higiene de dados

- Revisar as 11 reclassificacoes sugeridas.
- Tratar manualmente os 15 `other` inconclusivos.
- Substituir/reclassificar os 2 espelhos PDF.
- Confirmar os 10 XLSX core como documentos validos.

### Fase 2 - Preflight

- Criar backup PostgreSQL + `uploads`.
- Verificar API, PostgreSQL, Redis, Vertex, OCR e egress.
- Confirmar fila e leases vazias.
- Registrar snapshots de documentos, confianca, validacoes e alertas.
- Confirmar DEMO com 11 documentos antes da operacao.
- Definir janela operacional sem edicao concorrente dos processos do lote.

### Fase 3 - Piloto

- Escolher um processo real representativo e nao concluido.
- Reprocessar apenas seus documentos canonicos.
- Executar uma reconciliacao e uma validacao final.
- Verificar historico, projecao, Drive, Chat, alertas, custo e tempo.

### Fase 4 - Lote

- Um processo por vez.
- Nao iniciar o proximo processo enquanto houver documento sem estado terminal.
- Pausar automaticamente em falha sistemica.
- Tratar `completed` por politica separada.
- Ao fim de cada processo: rebuild, reconcile, validacao unica e liberacao dos
  efeitos externos aprovados.

### Fase 5 - Criterios De Encerramento

- DEMO sem qualquer alteracao ou novo run.
- Todos os 42 candidatos com run novo ou falha explicita.
- Zero candidato pendente.
- Zero lease ativa.
- Fila vazia.
- Historico anterior preservado.
- Projecao baseada no documento canonico utilizavel.
- Uma validacao final por processo aplicavel.
- Sem duplicata inesperada no Drive.
- Alertas e custo reconciliados com o snapshot inicial.
- Relatorio final por processo e tipo.

## Evidencias Consultadas

- `apps/api/src/modules/documents/service.ts`
- `apps/api/src/modules/documents/routes.ts`
- `apps/api/src/modules/documents/reconcile.ts`
- `apps/api/src/modules/validation/service.ts`
- `apps/api/src/modules/email-ingestion/classify-document.ts`
- `apps/api/src/shared/database/schema.ts`
- `apps/api/src/shared/queue/index.ts`
- `apps/api/src/shared/queue/workers.ts`
- `apps/api/src/shared/middleware/rate-limit.ts`
- migrations `0015`, `0018`, `0020`, `0024` e `0025`
- `docker-compose.prod.yml`
- `README.md`, `CHANGELOG.md`, `docs/RUNBOOK.md`
- `docs/PROJECT_MEMORY.md`, `docs/SESSION_MEMORY.md`,
  `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md`, `docs/ROADMAP.md`
- `docs/STATUS-2026-06-22.md`, `docs/STATUS-2026-07-17.md` e
  `docs/REVISAO-DOCS-UX-2026-07-17.md`
- consultas read-only ao PostgreSQL, filesystem e configuracao nao secreta de
  producao em 2026-08-03.

Grau de confianca geral: alto para inventario, arquitetura e riscos observados;
medio para tempo/custo futuro; classificacoes sugeridas exigem confirmacao
humana antes de persistencia.

## Testes

Executado:

```bash
npm test -w apps/api -- \
  src/modules/documents/__tests__/extraction-history.test.ts \
  src/modules/documents/__tests__/service.test.ts \
  src/modules/email-ingestion/__tests__/classify-document.test.ts
```

Resultado:

- 3 arquivos aprovados;
- 42 testes aprovados;
- 0 falhas.

## Alteracoes Desta Rodada

- Documentacao e memoria atualizadas.
- Nenhuma mudanca de codigo, banco, fila, configuracao ou producao.
- Nenhum reprocessamento executado.

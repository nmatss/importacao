# Correções do aceite de Odett e Eduarda — 18/09/2026

Estado em 18/09/2026, 12:58 BRT: produção `963f8077520218f6f195d1eba681014f7b6c3eed`
(PR [104](https://github.com/nmatss/importacao/pull/104) integrado por merge commit). Health
`ok`. `DOCUMENT_SOURCE=drive`, `EMAIL_INGESTION_ENABLED=false`, `FOLLOW_UP_SYNC_MODE=dry_run`,
`LINX_WRITE_ENABLED=false` no `.env` e no runtime da cert-api. Planilhas-fonte não foram
alteradas. Aceite operacional global permanece parcial.

## Publicação PR 104 e Follow-up dos três pilotos

- Merge: `gh pr merge 104 --merge` → `963f807`. CI 12/12 verde; `mergeable=MERGEABLE`,
  `mergeStateStatus=CLEAN`.
- Deploy: checkout `/tmp/importacao-release-20260918` limpo em `master` = `origin/master`,
  `EXPECTED_LINX_WRITE_ENABLED=false ALLOW_SYDLE_SYNC_DEPLOY=1
  CURL_CA_BUNDLE=/tmp/importacao-release-internal-ca-public.crt`. Backup
  `importacao_2026-09-18_154953*`. APP_VERSION/REVISION = `963f807`.
- Refine publicado em `sheet-columns.ts` e no `dist` do container: datas em Consolidação
  (PKT&IMG) ficam `unavailable`, referência preservada.
- Follow-up dry_run dos códigos PK2192607SZ / PK2202608SZ / IM0762607NB: 32 alterações
  (13/15/4), `consolidationRef` ausente em `changes` e presente em `unavailable` com o motivo
  de preservação. `blNumber` continua coluna ausente na fonte; BL não foi apagado.
- Apply único autorizado após essa prévia: 32 gravadas no cadastro. Dry_run seguinte: 0
  alterações restantes. Referências de consolidação antes/depois:
  PK219/PK220 `KIOM GLOBAL LIMITED`; IM076 `PK2122607NB` + `IM0762607NB` (duas linhas).
- Eventos `source_review_pending`: 287/288/297 consolidação (ids 2903/2904/2905) e 288 item
  PK220 27.01.0007 vs 27.01.2007-228 (id 2906). Sem substituição de código.

## Leitura de certificação após o deploy

Uma leitura manual `POST /api/sync-sheets` (ator `postdeploy-read-963f807`) em 12:58 BRT
completou com escrita Linx desligada. Escopo Sheets somente leitura; o módulo de atributos
Linx só lê o ERP e grava `linx_*` no Postgres.

| | 12:30 (startup pós-PR 103) | 12:58 (manual pós-PR 104) |
| --- | ---: | ---: |
| linhas de planilha | 947 (566+381) | 947 |
| pendências de fonte | 5 | 5, mesmos números de certificado |
| produtos / `linx_synced_at` | 674 / 674 | 674 / 674 |
| `validade_certificado` preenchida / nula | 541 / 133 | 541 / 133 |
| `PENDENTE_CADASTRO` / `cert_status=PENDENTE` | 0 / 0 | 0 / 0 |

Pendências preservadas: `PI4368Y`, `PI6014Y`, `100400422`, `100400423` (vínculo ambíguo);
`050403623` (marca vs Encerramentos, sem linha ativa). Leitura Linx: Puket 397, Imaginarium 277,
erros `[]`. O aborto horário de 11:20 (`Vinculo de certificacao ambiguo` / etapa Linx não
executada) não é mais o caminho vigente: startup 12:30 e hourly 12:20 já tinham 947/5 + 674.

## Decisão aprovada: cadastro integrado a Produtos

O usuário confirmou: **“Sim, integrar e sinalizar conflitos”**. O cadastro validado passa a
compor a leitura de Produtos, filtros, contadores, detalhes, validação e relatórios. O snapshot
original da planilha permanece intacto. A composição usa as colunas públicas existentes.

- Cadastro novo ou compatível fornece número, situação, validade e fim de venda efetivo.
- Vínculos por item prevalecem sobre o pai; encerramento individual conserva o certificado dos
  demais itens. Remoção de vínculo restaura a leitura da fonte original.
- Número/marca conflitantes, candidatos ambíguos e contradições de encerramento ficam como
  **Pendente de vínculo**, com motivo e identificação das fontes; não substituem silenciosamente
  o certificado original. Envio ao Linx é impedido quando há conflito com a fonte.
- Licenciamento mantém sua origem Linx. Licença vencida continua bloqueando venda mesmo quando
  existe pendência cadastral; pendência não equivale a venda liberada.
- Novos SKUs recebem somente um registro de suporte para guardar futuras observações Linx/site.
  Inserção não sobrescreve registros existentes. Nenhuma coluna externa foi criada ou movida.

Evidência: PostgreSQL descartável, cadastro HTTP, consulta de Produtos, restrição individual,
conflito com snapshot, filtro de pendência, exportação XLSX e remoção de vínculo. Fonte original
conferida antes/depois. Testes de escrita Linx usam SQL Server isolado, sem acesso de escrita ao ERP.

## Documentos e comparativo

- Valores copiados do espelho não servem como confirmação independente da invoice/packing,
  nem no comparativo, nem no Registro, nem na execução das verificações.
- Verificação não executada mantém resultado incompleto; não é escondida por outra aprovada.
- Valores monetários são comparados em centavos; diferenças pequenas são atenção, não igualdade.
  Comparação também considera a coluna Sistema quando aplicável.
- Seleção explícita de arquivos no comparativo/Registro permite inspecionar versões. IDs são
  validados por tipo e processo. Inspeção alternativa é somente leitura: não reaproveita aceites
  e não persiste uma escolha canônica para futuras rotinas.
- Parser recusa código transformado em data pelo Excel, com indicação para corrigir a origem.
- Fallback conservador do rascunho DUIMP recupera a tabela completa apenas quando a contagem e
  as colunas são demonstráveis; mantém referência, unidade e quantidade comercial impressas.
  Nos PDFs reais 164/171 foram recuperados 3/14 itens, sem substituir resultados já existentes.
- Percentual abaixo de 90% não é arredondado visualmente para 90% nos indicadores operacionais.

### Evidência real de BL, sem persistir nova extração

Poppler recupera texto dos PDFs que `pdf-parse` devolvia vazio. Uma nova chamada ao provedor Vertex
configurado no servidor recuperou os campos principais abaixo. É diagnóstico, não reprocessamento
persistido nem garantia de acerto de todos os campos.

| Processo / documento | Confiança medida |     CBM | Resultado do piso de 90%           |
| -------------------- | ---------------: | ------: | ---------------------------------- |
| PK220 / 350          |          90,818% | 120,246 | Atinge                             |
| PK219 / 166          |          89,670% |  65,527 | Não utilizável; permanece pendente |
| IM076 / 156          |          90,954% |   1,432 | Atinge                             |

PK220/IM076 continuam sem data de embarque nessa extração. A passagem adicional de autorreparo
teve resposta inválida nesses dois casos, preservando a extração principal. Não houve redução do
piso, preenchimento inventado ou transformação de posições SH de quatro dígitos em NCM completo.

## UX/UI e qualidade

Revisão orientada pelas skills do MCP Cultura Builder já consultadas: revisão de código,
design de interfaces e segurança OWASP. Corrigidos erro apresentado como saldo zero em Câmbios,
mensagem incorreta de permissão na Pré-Conferência, perda de rascunho do novo processo, validação
de intervalo, título/foco na navegação, contraste, nomes de gráficos, headings e regiões roláveis.

92 varreduras automatizadas Axe em 46 URLs/abas, temas claro/escuro: zero violações nos cenários
finais; zero erros de navegador e overflow global registrado. Smoke de navegação: 39 aprovados.
Essas medições usam ambiente e fixtures de teste; não substituem aceite humano com dados reais.

## Validação executada

- `EXT01_PDF_FIXTURES_DIR=/tmp/importacao-fix-real-pdfs npm test`: API 2.108 aprovados, 1 teste
  live de IA não habilitado; web 432 aprovados. Regressão adicional do limiar visual: 13 testes
  aprovados em AiExtractionSummary/DocumentList, incluindo o novo caso 89,999%.
- `CERT_RUN_POSTGRES_TESTS=1 CERT_RUN_SQLSERVER_TESTS=1 apps/cert-api/.venv/bin/python -m pytest
apps/cert-api/tests -q`: 1.207 aprovados, nenhum ignorado, incluindo os bancos descartáveis.
- `npm run typecheck`, `npm run lint`, `npm run build`, Prettier dos arquivos alterados e Ruff
  executados; logs locais em `/tmp/importacao-fix-*` (artefatos temporários, não versionados).
- API E2E: primeira rodada teve falha de preparação do PostgreSQL no arquivo de processos;
  os 69 testes restantes passaram e os 5 de processos passaram na repetição isolada.
  Repetição completa de `CI=true npm run test:e2e -w apps/api`: 9 arquivos/74 testes aprovados.
- Artefato visual final: `output/playwright/ux-review-20260918/accessibility-final.json`.

## Pendências reais para aceite operacional

| Prioridade | Pendência                                            | Critério de fechamento                                                                                                                                  |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALTO       | Publicação das correções                             | **Publicado** em `963f807` (PR 104). Cadastro→Produtos já estava em `71e067f`. Smoke e follow-up dos três pilotos feitos.                              |
| ALTO       | Sync de certificação parado no snapshot produtivo    | **Leitura comprovada** em 12:58: 947 linhas, 5 pendências preservadas, 674 leituras Linx, escrita ERP desligada. Restam 133 SKUs sem validade na fonte e a trava FIM_VENDAS. |
| ALTO       | Follow-up em dry_run                                 | **Aplicado nos três pilotos** (32 campos). Cron geral permanece `dry_run`. Coluna BL ausente na fonte; não apagar BL. Pendência de datas de consolidação. |
| ALTO       | Trava final de venda no ERP não homologada           | Demonstrar menor data válida entre fim de venda da certificação e licenciamento, com nulos/sentinelas e dupla certificação                              |
| ALTO       | PK219 BL abaixo de 90%                               | Extração/verificação suficiente sem relaxar regra ou inventar campos                                                                                    |
| ALTO       | Versões concorrentes em comparativo/Registro         | Área confirmar fontes vigentes; seleção temporária não resolve escolha persistente                                                                      |
| MEDIO      | PK220 referência divergente                          | Packing contém 27.01.0007; espelho e DUIMP contêm 27.01.2007 (DUIMP com sufixo -228). Confirmar com área; não substituir automaticamente                |
| MEDIO      | Registro dos pilotos e IM076 sem rascunho confirmado | Fontes completas, extração persistida, comparação por item e aceite real                                                                                |

Consulta somente leitura aos triggers das tabelas de propriedades encontrou `LXU_PROP_PRODUTOS`
na Puket sem referência a FIM_VENDAS/propriedades examinadas, e nenhum trigger nessa tabela da
Imaginarium. Isso **não exclui** jobs/procedures em outros pontos do ERP, mas não comprova a
propagação. `LINX_WRITE_ENABLED=false` continua preservado. Não zerar licenciamento a partir
de planilha que contém somente certificação.

## Retomada e publicação

PR 104, o follow-up dos três pilotos e a leitura de certificação já estão em `963f807`. Escrita
Linx permanece desligada. Próximo foco: BL PK219 abaixo de 90%, trava FIM_VENDAS no ERP, versões
concorrentes no comparativo/Registro, a divergência de item PK220 e as 5 pendências de fonte
da planilha de certificação.
para Odett/Eduarda.

Não declarar “100% integrado” ou “Finalizado” enquanto as pendências acima permanecerem.

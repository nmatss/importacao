# Correções do aceite de Odett e Eduarda — 18/09/2026

Estado: implementação local validada; aceite operacional global ainda pendente. Base local
`0e3434b` com alterações desta sessão e alterações preexistentes preservadas. Produção consultada
em `6cbb9c2`. Nenhum push, deploy, reset de propriedades Linx ou alteração das planilhas foi feito.

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
| ALTO       | Publicação das correções                             | Push explicitamente autorizado; master limpo/sincronizado; `scripts/deploy.sh`; smoke e reconciliação pós-deploy                                        |
| ALTO       | Sync de certificação parado no snapshot produtivo    | Publicar, executar leitura e comprovar sucesso/pendências por SKU; preservar conflitos                                                                  |
| ALTO       | Follow-up em dry_run                                 | Prévia medida: 35 alterações nos três pilotos (14/16/5); revisar/aplicar e conferir dados/relatórios; coluna BL ausente na fonte não autoriza apagar BL |
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

Revisar o diff local com os novos arquivos antes de montar release. Preservar alterações de outras
execuções e excluir auxiliares temporários de auditoria. A migration de proveniência interna
`20260918_encerramento_provenance.sql` integra o conjunto local; a composição Cadastro→Produtos
não adiciona migration. Publicação deve seguir o gate do AGENTS.md, mantendo escrita Linx
desligada até homologação específica. Após deploy, repetir pilotos e reconciliar antes/depois.

Não declarar “100% integrado” ou “Finalizado” enquanto as pendências acima permanecerem.

## Decisões confirmadas durante a publicação

O usuário autorizou push/integração/deploy e confirmou que a divergência PK220 fica pendente
para Odett/Eduarda. Também determinou preservar a referência de consolidação e sinalizar as
datas dessa coluna como pendência. O parser Follow-up passou a recusar datas nesse campo de
referência, mantendo os demais campos disponíveis para sincronização. Fontes não alteradas.
A revisão integrada incorporou `c1b80ad` (licenciamento), com 1.234 testes Python e 442 web
aprovados, além de 2.108 testes API antes desta proteção adicional. PR103/71e067f publicado
primeiro; esta proteção complementar segue publicação e validação próprias.

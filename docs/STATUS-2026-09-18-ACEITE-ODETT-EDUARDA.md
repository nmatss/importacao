# Revisão do aceite de Odett e Eduarda — 18/09/2026

## Veredito e escopo

**Não fechamos a entrega da reunião e não há evidência de funcionamento 100% integrado.**
Há funcionalidades implementadas e melhorias comprovadas, mas o fluxo documental dos três
pilotos permanece parcial e a sincronização produtiva de certificação está falhando.

Auditoria de continuação, somente leitura nas fontes e em produção. Referência: transcrição
de 11/09 fornecida pelo usuário. Consulta atual de banco às **14:15 UTC / 11:15 de Brasília**,
com leituras subsequentes do comparativo, Registro e arquivos. Produção: revisão
`6cbb9c260460ca0b8bde9a155c960d3b003cfea4`; checkout local: `0e3434b` mais alterações
preexistentes de outra execução, inclusive proveniência do encerramento e CLI Linx.
Não foram alterados aplicação, dados, colunas, fontes, permissões, jobs ou configuração remota.

Método: MCP Cultura Builder (`revisao-de-codigo`), skills Google Drive/Sheets e PDF;
fontes oficiais, SELECTs, execução dos métodos de leitura do runtime publicado,
funções puras, inspeção visual de PDF e testes locais. Sem nova inferência de IA,
reprocessamento persistente, sincronização aplicada, deploy, escrita Linx ou envio ao chat.

## Fontes oficiais confirmadas

- [PROCESSOS](https://drive.google.com/drive/folders/1Maw9MHYAFsNQgK9F7ilXEtXVf-eG-0zx):
  subpastas `04. PENDENTES DE CORREÇÃO`, `01. ESPELHOS`, `03. PUKET`, `02. IMAGINARIUM` acessíveis.
- [Follow-up](https://docs.google.com/spreadsheets/d/1fN1Q8KwrSYW55JpWNgQQ61JbS3zg1Ft2OqML6ziwN_Q/edit):
  título `1_Follow Up Processos de Importação`, aba `Processos`, configurada em produção.
  PK220 linha 1386, PK219 linha 1388, IM076 linha 1399.
- [Certificação](https://docs.google.com/spreadsheets/d/1qcgcj9814UFikhurgvsTTcUxvPF2r3w_QY_EurvBtSE/edit):
  cabeçalhos atuais de Imaginarium, Puket e Encerramentos consultados. Coluna G é lembrete de
  transferência, H é prazo final de venda, N é `DUPLA CERTIFICAÇÃO`.
- [Espelho PK220](https://docs.google.com/spreadsheets/d/1AtrtiA2BJOSmSCpACQssTloYgpV-zikO0r2fm-hfwGQ/edit):
  aba `Por processo`, cabeçalho e itens consultados.
- [Cronograma existente](https://docs.google.com/spreadsheets/d/1x-fiupCUSebuWlgE72ASrPdTavscjXdWH_EoGvdRzQs/edit):
  30 tarefas, fases, responsáveis e datas de 14/09 a 23/10; etapa de liberação bloqueada.
  A tarefa de publicação no chat está marcada concluída na planilha; a mensagem efetivamente
  enviada não foi verificada. Não foi criado cronograma duplicado.

## Evidência operacional decisiva

| Verificação                   | Resultado atual                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fonte automática documental   | `DOCUMENT_SOURCE=drive`, `EMAIL_INGESTION_ENABLED=false`                                                                               |
| Escrita nas fontes            | `DRIVE_WRITE_MODE=off`; Linx `LINX_WRITE_ENABLED=false`                                                                                |
| Documentos                    | 994 com origem e vínculo Drive; 51 legados e 16 manuais. Todos marcados processados; isso não significa extração correta ou utilizável |
| Follow-up recorrente          | `FOLLOW_UP_SYNC_MODE=dry_run`: calcula diferenças, não atualiza o cadastro                                                             |
| Sync certificação desde 12/09 | **148 execuções, 148 com erro**; última 18/09 13:20 UTC                                                                                |
| Motivo do sync                | Vínculo de certificação ambíguo; 0 sincronizados; etapa Linx não executada                                                             |
| Snapshot de produtos          | **674 produtos**, nenhum com `validade_certificado`, nenhum com `linx_synced_at`; 167 ainda como Puket Escolares                       |
| Comparativo publicado         | PK219, PK220 e IM076 retornam `hasBl=false`                                                                                            |
| Registro publicado            | Os três pilotos retornam `pending`                                                                                                     |

Contêineres saudáveis não comprovam essas rotinas: web/API/cert-api estavam healthy enquanto
o sync falhava. As correções locais de certificação descritas no
[STATUS específico](STATUS-2026-09-18-CERTIFICACAO-SYNC-PARADO.md) não estavam publicadas nesta leitura.

### Documentos dos pilotos

| Processo | Fonte efetiva do comparativo                                | Resultado                                                                                                                      |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PK220    | Invoice 349, packing 348, espelho 351; BL excluído          | 14 itens, zero sem correspondência INV/PL; quantidades presentes. Packing XLSX com CBM nulo. BL 350 com 89,89%, abaixo do piso |
| PK219    | Invoice 345, packing 344, espelho 346; BL excluído          | 3 itens, zero sem correspondência INV/PL; CBM nulo no packing XLSX. BLs manuais antigos com 39% e 50,61%                       |
| IM076    | Invoice 1144, packing manual 160, espelho 1162; BL excluído | 1 item, quantidade 1.008 em INV/PL/espelho; CBM nulo no packing selecionado. BLs antigos com 47,44% e 50%                      |

O packing PDF do PK220 (documento 168) mostra visualmente **120,246 m³**, 1.375 caixas,
12.560,68 kg líquidos e 13.997,48 kg brutos. Poppler + `fillPackingListNullsFromText` do
runtime atual recupera o CBM como 120,246 (confiança do preenchimento 0,6). A extração persistida
desse PDF continua nula; o comparativo escolhe o XLSX 348, cujo texto não contém CBM.
Portanto, há capacidade técnica de leitura, mas falta resolver a fonte vigente e atualizar a
extração efetivamente consumida. Não é justificável baixar o piso de 90% do BL para encerrar o item.

### Divergências contra o Follow-up atual

| Campo                | Follow-up oficial agora            | Cadastro/coluna Sistema                |
| -------------------- | ---------------------------------- | -------------------------------------- |
| PK220 FOB            | US$ 101.346,01                     | US$ 101.265,19                         |
| PK220 CBM            | 120,25                             | 179,670                                |
| PK220 ETA realizado  | 06/09/2026                         | `eta_actual` nulo; ETA 18/09           |
| PK219 ETA realizado  | 08/09/2026                         | `eta_actual` nulo; ETA 17/09           |
| PK219/PK220 registro | Número e data 04/09/2026 presentes | `duimp_number` e `registered_at` nulos |

Os campos de peso/caixas do cadastro também estão nulos, mas isso, isoladamente, não prova que
a capa está vazia: a interface pode compor valores de documentos. A divergência da coluna Sistema
foi comprovada executando `documentService.getComparison`, e não apenas olhando colunas do banco.

## Achados e riscos

### R01 — ALTO: certificação e licenciamento não sincronizam

Os 148 erros e os 674 snapshots incompletos impedem aceitar status, relatórios, renovação,
dupla certificação e prazo de venda como atualizados. O botão de sincronizar existe, mas o
processamento publicado aborta por ambiguidade. Código local trata pendências por SKU e separa
a leitura Linx; ainda exige release e comprovação de gravação/sync bem-sucedidos.

### R02 — ALTO: Follow-up está em simulação e valores operacionais estão desatualizados

`apps/api/src/modules/follow-up/sheet-sync.ts` e `jobs/follow-up-sheet-sync.ts` respeitam
`dry_run`. A diferença real no PK220 e nas datas de PK219/PK220 confirma o efeito operacional.
Ativar não é tarefa desta auditoria: preparar diff, verificar origem, preservar campos e
homologar a aplicação e os ciclos seguintes.

### R03 — ALTO: extração utilizável dos BLs e CBM do packing não fechada

Os três comparativos não têm BL operacional. O pipeline mantém PDFs antigos e planilhas do
mesmo processo; `newestSource` escolhe uma fonte que pode ter menos informações. O packing PDF
correto recupera CBM em diagnóstico, mas o resultado não alimenta o comparativo atual.
Resolver documento vigente por tipo/versão e reprocessar apenas o lote revisado; confirmar
campos e valores, não só a nota global. Quantidades INV/PL e casamento dos itens melhoraram.

### R04 — ALTO: concordância pode reutilizar a mesma fonte e ocultar diferenças

`reconcile-core.ts:reconcileField` preenche campos ausentes de invoice/packing com dados do
espelho e grava `source=espelho`. `flattenAiData` elimina esse metadado ao produzir os valores
comparados. Reprodução pura: packing sem peso + espelho com 100 resulta em packing 100,
origem espelho, e comparação `match`. Isso não comprova duas leituras independentes.
Campos reais dos pilotos também têm `source=espelho`, embora esse marcador sozinho não
distinga preenchimento de confirmação de valor preexistente.

Além disso, `comparison-core.ts` usa tolerância numérica genérica de 0,5% e
`highestRowStatus` dá prioridade a `match` sobre `skipped`. No PK220, FOB de 101.346,01 e
101.246,01 aparece `match`; a coluna Sistema 101.265,19 não participa diretamente desse cálculo.
CBM 120,246 versus Sistema 179,670 também aparece `match` com ressalva textual de cruzamento
não verificado. Propor tolerâncias por campo, origem por célula e estado explícito de validação
incompleta; não alterar silenciosamente uma tolerância de negócio.

### R05 — ALTO: Registro ainda não conclui a comparação real

Execução de `buildRegistroComparison` sobre documentos produtivos, convertendo `drive_version`
para número como faz o schema Drizzle: PK219 e PK220 têm invoice ambígua; PK219 também tem
espelho ambíguo. Rascunhos 164/171 têm zero itens lidos. IM076 não tem DUIMP e tem invoices
ambíguas. A guarda que impede validação falsa é correta, mas o fluxo solicitado não está aceito.
DUIMPs finais foram importadas do Drive; o rascunho manual tem precedência e não é substituído
automaticamente pelo extrato final.

### R06 — MEDIO: dado incorreto no espelho oficial e proteção insuficiente do identificador

No PK220, `Por processo!D13` e `F13` exibem **27.01.2007** como EAN/código. O PDF do packing
mostra o código **27.01.0007**. O parser com `cellDates:true` transforma a célula em texto de
data, que chega ao Registro como `SKU Sat Jan 27 2007 ...`. A origem também precisa de revisão
pela área; não se deve inventar o EAN ou converter automaticamente uma data em SKU. Sinalizar
tipo inválido e preservar evidência. Nenhuma célula foi alterada.

### R07 — MEDIO: cabeçalho real de dupla certificação não é reconhecido

`erp_service.py:530` procura `dupla certificação?` ou `dupla certificacao?`; o cabeçalho
real é `DUPLA CERTIFICAÇÃO`, sem interrogação. Reprodução da função atual retorna `None`.
O preenchimento futuro da coluna N não será lido por esse caminho. A identidade dos certificados
continua sendo necessária; a coluna não deve substituir a resolução do vínculo vigente.

### R08 — ALTO: cadastro, painel e trava efetiva Linx não formam ainda um ciclo homologado

Cadastro tem fim de venda, vínculos e restrições por item; correções de formulário/lote são
locais. Não existe reconciliação automática cadastro → snapshot Produtos. Ativo/sem data não
remove propriedade antiga do ERP. O portal lê `PRODUTO_CORES.FIM_VENDAS`, mas não escreve nela;
a propagação ERP da propriedade para a trava final depende de homologação externa.
`LINX_WRITE_ENABLED=false` confirma que nenhuma carga está ativa pelo portal. Não equivale a
dizer que o Linx inteiro não tem outras rotinas ou travas. Detalhes em
[campos e parâmetros](CERT-CAMPOS-E-PARAMETROS.md) e [contrato de escrita](CERT-LINX-WRITE.md).

### R09 — MEDIO: qualidade de uso e evidência de testes ainda têm limites

Revisão UX/UI anterior nesta sessão encontrou contraste, teclado, feedback de erro e rascunho
perdido; 412 combinações responsivas sem quebra global não eliminam esses problemas.
[Relatório UX/UI](STATUS-2026-09-18-REVISAO-UX-UI.md). Nesta rodada, o primeiro `npm test`
falhou no teste temporal de cache; repetição isolada passou. Não esconder a instabilidade.

## Matriz de fechamento dos pedidos

“Implementado” indica código/teste ou resposta de leitura comprovada; não equivale ao aceite das
áreas. “Parcial” indica comportamento existente com lacuna operacional demonstrada.

| Pedido da reunião                              | Situação e evidência                                                    | O que falta para encerrar                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Drive apenas, sem e-mail                       | Comprovado nas flags e 994 vínculos                                     | Manter monitoramento de ingestão e erros                                   |
| Pendentes antes das marcas                     | Implementado por tipo, contrato e testes `drive-layout`/ingestion       | Homologar substituição real de versão, sem duplicação                      |
| Espelhos em pasta própria                      | Comprovado nos pilotos; PK220 351 em `espelhos`                         | Resolver versões/arquivos ambíguos no Registro                             |
| CBM e quantidade do packing                    | Quantidades e correspondência presentes; CBM ausente                    | R03: fonte PDF e reextração dirigida                                       |
| Melhorar BL selecionável                       | Parser melhorado; três pilotos sem BL utilizável                        | Reprocessamento revisado e gabarito por campo                              |
| BL abaixo de 90% não utilizável                | Comprovado: constante 0,9 e exclusão de 350 com 0,8989                  | Preservar regra durante correções                                          |
| Invoice/espelho/fabricantes                    | Implementação e dados disponíveis; não totalmente independentes         | R04, conferir fabricante por item com fonte real                           |
| Resumo clicável/colorido único                 | Implementado; revisão UI anterior                                       | Aceite de uso da área                                                      |
| Cruzamentos em colunas claras                  | Implementado no retorno das cinco fontes                                | R04: origem de cada célula e não verificados                               |
| Remover duplicatas sem perder NCM/BL           | Testes do comparativo existentes                                        | BL válido para verificar cruzamentos reais                                 |
| CNPJ sem pontuação                             | Comprovado em PK219/PK220/IM076 como match                              | Sem pendência observada nesse exemplo                                      |
| PI/coleção não prejudicar SKU                  | Zero itens sem correspondência nos três pilotos                         | Revalidar cenários com códigos ambíguos/duplicados                         |
| Mensagem quando todos encontrados              | Implementada no comparativo/UI                                          | Quantidade/unidade e independência ainda precisam de aceite                |
| Sistema = Follow-up; FOB correto               | Parcial; fonte correta configurada, snapshot desatualizado              | R02                                                                        |
| Capa completa, origem e atualização            | Precedência por campo implementada                                      | Sincronização real, fonte vigente e revisão visual com dados atuais        |
| Barra fixa compacta, observação/datas          | Implementada em ProcessDetail/Header; cobertura UI                      | Pendências de acessibilidade no relatório UX                               |
| Transporte antes e datas sem dia a menos       | Layout e formatação implementados/testados                              | ETA realizado/registro atuais não chegaram ao cadastro                     |
| Checklist adicionar/excluir/reordenar no local | Implementado, catálogo/rotas/testes; aba Etapas redirecionada           | Teste autenticado com perfil operacional e persistência                    |
| Retirar etapas obsoletas                       | Catálogo inativa rotina antiga sem apagar fonte                         | Aceite da lista com a área                                                 |
| DUIMP na pasta e Registro comparativo          | Parcial: extratos finais Drive, rascunhos manuais; pending              | R05 e correção da fonte R06                                                |
| Analista excluir documento errado              | Rota sem restrição exclusiva admin, motivo/auditoria/tombstone          | Homologar perfil real sem apagar arquivo físico no Drive                   |
| Menor prazo real certificação/licença          | Regras locais e testes; certificado usa fim de venda                    | Sync produtivo + propriedades + trava final ERP                            |
| Ativo sem prazo de certificação                | Regra local; licença pode bloquear separadamente                        | Sanear resíduos com plano conciliado, não zerar tudo                       |
| Status não usa prazo final como validade       | Campos separados e regras locais                                        | Snapshot produtivo não recebeu validade; tratar contradições da origem     |
| Dupla certificação                             | Correções locais; proveniência interna em migration                     | Publicar, sincronizar e resolver pendências de vínculo; R07                |
| Abandonar Puket escolares                      | Leitor local ignora aba                                                 | Produção ainda conserva 167 registros antigos                              |
| Licenciamento/grife do Linx                    | Implementado localmente, sem atualização produtiva                      | 674 produtos sem data de leitura Linx; R01                                 |
| Coluna G inserida não deslocar prazo           | Cabeçalho H reconhecido por nome                                        | Coluna N tem incompatibilidade própria, R07                                |
| Atualização horária e botão forçar             | Job executa, mas falha; botão existe                                    | Execução bem-sucedida e observável, não apenas refresh da tela             |
| Cadastro fim de venda, lote e individual       | Implementado, correções locais testadas                                 | Publicar e homologar cadastro → vínculo → leitura/painel → ERP             |
| Número certificado em Produtos/relatório       | Implementado                                                            | Sincronizar valores atuais e preservar histórico correto                   |
| Marketplace Imaginarium                        | Auditoria implementada localmente, sem isenção automática por 500 peças | Execução real completa, amostra de terceiros e evidência do número no site |
| Cronograma no Sheets e chat                    | Planilha existente, 30 tarefas; envio marcado concluído                 | Evidência do envio e atualização dos achados desta auditoria               |
| Acompanhamento semanal                         | Tarefa A fazer no cronograma                                            | Aceite das áreas e rotina de acompanhamento                                |
| Reduzir mensagens de parados                   | Digest/deduplicação implementados                                       | Medir volume entregue e confirmar preferência operacional                  |
| Zerar/recarregar propriedades Linx             | Não executado; aplicação protegida                                      | Baseline com licenciamento, backup, diff e autorização da carga conciliada |

## Sequência de fechamento verificável

1. **Certificação:** concluir revisão da release local; publicar em fluxo autorizado; migration
   e sync com contagem, horário e pendências por SKU. Confirmar validade, marca e Linx no snapshot.
2. **Documentos:** fixar fonte vigente de cada tipo para PK219/PK220/IM076; preservar originais;
   recuperar CBM e BLs sem diminuir piso; conferir unidades, fabricantes e códigos com gabarito.
3. **Follow-up/comparativo:** revisar o diff real antes de ativar apply; corrigir concordância
   circular/validação incompleta; demonstrar FOB, CBM, ETA realizado e registro atuais na interface.
4. **Registro:** resolver seleção de invoices/espelhos; extrair rascunhos reais; corrigir origem
   do código corrompido com a área; comparar DUIMP/invoice/espelho por item e unidade.
5. **Linx/cadastro:** homologar certificado/item → propriedade de certificação, leitura da licença,
   menor prazo e bloqueio efetivo por cor. Ativo renovado não deve manter bloqueio antigo indevido.
6. **Aceite:** perfis reais de Odett/Eduarda, checklist e exclusão auditada, marketplace e ajustes
   UX; atualizar o cronograma existente com resultados, responsáveis e dependências.

Não marcar tarefa concluída por testes com mocks, nota de confiança alta, health 200 ou job
agendado. Exigir resposta correta e evidência do ciclo de atualização com as fontes vigentes.

## Testes e limites desta rodada

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`: passaram.
- `npm test`: primeira execução falhou em `cache.incr > recomeca do 1 depois que a janela expira`
  (esperado 1, recebido 2); API 2.086 passaram, 1 falhou, 5 ignorados. Web não foi iniciado por
  esse comando após a falha.
- `npm test -w apps/api -- src/shared/cache/__tests__/incr.test.ts`: 4 passaram na repetição.
- `npm test -w apps/web`: 426 passaram.
- `apps/cert-api/.venv/bin/python -m pytest -q apps/cert-api/tests`: 1.175 passaram, 2 ignorados
  opt-in. Integração PostgreSQL opcional foi comprovada em rodada anterior, não repetida aqui.
- `apps/cert-api/.venv/bin/ruff check apps/cert-api/app apps/cert-api/tests apps/cert-api/scripts`:
  passou; `git diff --check` passou antes da documentação.
- `npm test -w apps/api`: repetição completa aprovada, **2.087 passaram, 5 ignorados**. A falha
  temporal inicial continua registrada; nenhuma correção de teste ou aplicação foi feita aqui.

Não houve nova sessão de navegador autenticada como as usuárias, carga Linx, validação real nova
do marketplace, envio de chat ou prova de aplicação de dados. Revisão de código/contratos de
auth, exclusão auditada, upload e guardas de escrita não equivale a pentest completo. Evidências
temporárias em `/tmp/importacao-audit-reuniao-20260918/`; arquivos reais não foram versionados.

Alterações desta auditoria: este relatório, registro de pendências e memória da sessão.

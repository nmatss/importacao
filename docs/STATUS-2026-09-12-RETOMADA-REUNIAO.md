# Retomada da reunião — 12/09/2026

Estado mais recente: seção **Retomada R5 — desbloqueio de CI**, ao final. As rodadas anteriores são histórico.

Estado: **correções locais implementadas e testes técnicos concluídos; entrega global parcial, sem publicação ou homologação integral**. Base `f4aa948`, branch
`fix/reuniao-2026-09-11`. Pedido atual de 30 entregas, transcrição e 15 capturas são o contrato.
O histórico de 11/09 não comprova o estado desta revisão.

Plano/checkpoints: `.context/plans/retomada-reuniao-importacao-2026-09-12.md`, sessão dotcontext
`11eb5436-440b-4a2d-bd6c-2bf5e9267a8f`. Quatro frentes: certificação/Linx, documentos/API,
Registro/DUIMP e interface/QA. Integração e fontes externas pelo agente principal.

## Fontes verificadas ao vivo (somente leitura)

- Follow-up `1fN1Q8KwrSYW55JpWNgQQ61JbS3zg1Ft2OqML6ziwN_Q`, aba **Processos**, gid 0.
  Linha 1388: PK2192607SZ, USD 85.313,93, ETD 07/08/2026, ETA Realizado 08/09/2026,
  registro 04/09/2026 e chegada CD 11/09/2026. ETA Previsto Médio nesta consulta: 17/09/2026;
  não deve substituir o realizado.
- Certificação `1qcgcj9814UFikhurgvsTTcUxvPF2r3w_QY_EurvBtSE`: gid 1429080384 é **Notas**.
  Integração: Imaginarium (gid 0), Puket (815522317), Encerramentos (1037418503).
  Puket escolares ainda existe. Não foi apagada nem alterada. Comparação por SKU da coluna A
  (legada) contra C da Puket: 164 únicos antigos, 286 na Puket, 164 encontrados e zero ausentes;
  normalização de zeros só na comparação, sem modificar fonte. Vínculos não reconciliados por esse teste.
- Nas marcas, cabeçalhos CÓDIGO, Fornecedor, Validade da Certificação, Número Certificado,
  SITUAÇÃO e Prazo Final Venda. Encerramentos: CERTIFICADO, SKU, PRAZO FINAL VENDA,
  STATUS e Dupla certificação?. G é lembrete; H é prazo final. N2:N3 vazios na amostra;
  isso não comprova inexistência de dupla certificação.
- PROCESSOS `1Maw9MHYAFsNQgK9F7ilXEtXVf-eG-0zx`: IDs das quatro pastas conferidos.
  IM0762607NB em Pendentes; PK219/PK220 em Puket/2027/HIGH SUMMER. Espelhos reais
  PK219/PK220 na pasta 01. ESPELHOS, aba Por processo (gid 2135926262).
- Espelho PK219: 13.963 peças, 699 caixas, bruto 5.941,50 kg, líquido 5.242,50 kg,
  65,527 CBM, USD 85.313,93. PK220: 90.615 peças, 1.375 caixas, bruto 13.997,48 kg,
  líquido 12.560,68 kg, 120,246 CBM, USD 101.246,01. SKU aparece sem zero inicial
  em células do espelho; não autoriza reescrever dados ou eliminar prefixos legítimos.
- PDFs baixados com conta de serviço read-only para `/tmp/importacao-pilots-20260912/`.
  Nenhum documento real foi versionado. BLs distintos por hash: pdf-parse retorna texto vazio;
  inspeção visual confirma IM076 (42 cartons,399.000 KGS,1.432 CBM), PK219 e PK220.
- DUIMPs obtidas no Drive são **extratos finais versão 0001**, não rascunhos confirmados.
  PK219: 8 páginas; PK220: 30. Código de produto Portal Único não é automaticamente SKU.

## Linx: direção e contrato real

Consulta SQL Server via contêiner de certificação, somente SELECT, nas duas marcas:

| Marca       | Propriedade certificação (título atual) | Licenciamento                       | Consolidação comercial           |
| ----------- | --------------------------------------- | ----------------------------------- | -------------------------------- |
| Puket       | 00224 — VALIDADE DO CERTIFICADO         | 00225 — VENCIMENTO DO LICENCIAMENTO | PRODUTO_CORES.FIM_VENDAS por cor |
| Imaginarium | 00106 — VALIDADE DO CERTIFICADO         | 00107 — VENCIMENTO DO LICENCIAMENTO | PRODUTO_CORES.FIM_VENDAS por cor |

Tabelas/colunas confirmadas: PROP_PRODUTOS(PROPRIEDADE,PRODUTO,ITEM_PROPRIEDADE,
VALOR_PROPRIEDADE), PROPRIEDADE.TITULO_PROPRIEDADE, PRODUTO_CORES(PRODUTO,COR_PRODUTO,
FIM_VENDAS). SELECT de FIM_VENDAS permitido em ambas as marcas nesta consulta.
GRIFFE Puket e IMG_LICENCIAMENTO Imaginarium consultáveis; não há garantia de preenchimento.

Direção: Produto mantém licenciamento no Linx → sistema lê; certificação planilha/cadastro →
sistema → propriedade Linx somente após aprovação do mapeamento e carga. O título atual
VALIDADE DO CERTIFICADO não é prova de que o contrato de fim de venda foi aprovado pela equipe
Linx. Não renomeamos propriedades e não escrevemos datas.

Licenciamento: Puket 4.795 linhas, 2.464 vazias/1900; Imaginarium 1.696, 865 vazias/1900.
Esses totais não equivalem a SKUs dispensados de licenciamento. São necessária conciliação e
confirmação de aplicabilidade. Amostra Puket 050404509: 00225=1900 e FIM_VENDAS=05/11/2030;
Imaginarium PI4206Y: sem 00107 e FIM_VENDAS=24/05/2023. Não inferir prazo correto dessa amostra.

## Correções implementadas e revisadas

- BL: piso 90% na API/UI; extração ausente/falha não valida. Nota é confiança ponderada existente,
  não porcentagem literal de campos preenchidos. Campos ausentes continuam pendentes.
- Drive: rejeitar nome explicitamente associado a outro processo antes da prioridade por tipo.
- CNPJ/SKU/Odoo: comparação sem pontuação e sem sufixo parcial que una identificadores distintos.
- Registro: comparação DUIMP/invoice/espelho com arquivo, versão/hash e campo por célula; ausência,
  score insuficiente, extração skipped e referência de outro processo não viram sucesso. Resumo
  aninhado do espelho real é consumido. Quantidades exatas; diferenças monetárias/pesos dentro da
  faixa de tolerância exigem revisão. Cabeçalho determinístico não impede extração de tabelas DUIMP.
- Certificação: validade separada de prazo; licenciamento desconhecido vira pendência explícita;
  cadastro não pode sobrescrever licenciamento de Produto; marketplace sem regra automática 500.
- Sheets: esquema incompleto/ambiguidade de certificado não pode promover snapshot parcial.
- Interface: validade, fim de venda, situação comercial e motivos separados; sync não deve
  mostrar sucesso em falha; filtro Puket escolares removido.

## Revisão independente e evidências adicionais

Revisão cruzada encontrou e corrigiu: tolerância numérica indevida para quantidades, formato
summary do espelho, extração skipped consumida, exclusão histórica sobrepondo situação vigente
e descrição inexata de snapshot após sync parcial. Casos de regressão executados.

Imagem local `importacao-api:qa-20260912` construída com `apps/api/Dockerfile`.
`pdftotext` dentro da imagem, sem rede e com originais montados somente leitura: IM076 2.866
caracteres, PK219 2.928 e PK220 3.314; CMap Adobe-GB1 presente. Isso comprova a ferramenta de
extração textual na imagem, não a extração completa pelo provider nem o comportamento em produção.

Marketplace: `run_audit(persist=False)` consultou categoria pública Imaginarium e inventariou
173 produtos de terceiros; 169 com quantidade de peças, 158 com texto de certificação, todos
173 REVISAR. Texto pode ser declaração de dispensa: presença não prova certificado válido.
Evidência: `output/retomada-2026-09-12/marketplace-inventory.json`, sem escrita no banco.

## Pendências de homologação e operação

1. Certificação/Leticia: validar N e vínculo vigente por SKU, fornecedor e certificado. Modelo legado
   por SKU não preserva toda a seleção histórica; carga não pode escolher a última linha cegamente.
2. Áreas: confirmar dia limite inclusivo/exclusivo e aplicabilidade marketplace. Pergunta enviada ao
   solicitante; nenhuma resposta equivale a aceite. Não aplicar prazos genéricos Inmetro/Anatel.
3. Linx/Eli/Tiago: aprovar semântica das propriedades e dono de FIM_VENDAS; exportação anterior,
   conciliação por SKU/cor e restauração antes de qualquer carga definitiva.
4. Produção observada em 12/09: DOCUMENT_SOURCE=email, DRIVE_WRITE_MODE e FOLLOW_UP_SYNC_MODE
   não definidos, raiz Drive placeholder; Follow-up tab=Processos. Ativação requer backfill de hash,
   configuração/deploy autorizado e dry-run revisado. Nenhuma alteração remota realizada.
5. Importação: rascunho DUIMP real e vínculo de catálogo/SKU; homologar PK219/PK220/IM076 com
   provider de extração e casos completos, inclusive exclusão, reclassificação e reprocessamento.
6. Ativo não limpará automaticamente prazo antigo no Linx; regularização exige carga conciliada.

## Cronograma e contexto

[Planilha autorizada](https://docs.google.com/spreadsheets/d/1x-fiupCUSebuWlgE72ASrPdTavscjXdWH_EoGvdRzQs/edit#gid=1625841876):
Cronograma E10:E39 (status e notas) e Escopo e aceite F5:F34 (evidência/pendência), com releitura
confirmada. Mantidos responsáveis, estrutura, fontes, fórmulas e datas propostas 14/09–23/10.
Opções existentes: A fazer, Em andamento, Bloqueado, Concluído. Sem conclusão indevida de itens
que dependem de homologação; envio ao grupo e reuniões permanecem com Nicolas/áreas.

ai-memory padrão devolveu histórico Qlik, sem memória pertinente na busca global; não aplicado.
Dotcontext checkpoint funciona; link do plano não interpreta frontmatter atual e acusa sensores
faltantes mesmo após comparação com plano existente. Gate não foi forçado; validações diretas
foram registradas com resultados reais. Husky pre-commit configurado para lint-staged, não
executado pois não houve commit. Nenhum hook foi instalado ou alterado.

## Validação desta revisão

Validações proporcionais ao risco, sem ativar jobs remotos ou enviar mensagens:

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: **passaram** no gate integrado final, após congelamento das quatro frentes. API: 1.946 testes passaram e 5 ignorados; web: 369 passaram. Confirmação dos totais no log final.
- `python3 -m pytest -q apps/cert-api/tests`: **830 passed**, executado pelo principal após última correção.
- `python3 -m ruff check apps/cert-api/app apps/cert-api/tests`: passou.
- `npx prettier --check <arquivos TS/TSX/JS/JSON/CSS alterados>`: passou.
- `git diff --check`: passou.
- Playwright: **54 renders válidos**, soma de 9 cenários × 375/1024/1440 × claro/escuro. JSONs recontados pelo principal: zero erros, chamadas sem fixture, overflow ou elementos fora da viewport. Respostas controladas, não homologação produtiva.
- Imagem Docker construída e utilitários testados conforme seção anterior. A imagem foi construída antes das últimas correções do comparativo; comprova dependências PDF, não uma imagem final de release.

Comando da nova cobertura do Registro (3 testes/18 renders):

```bash
AUDIT_ASSERT=1 AUDIT_VIEWPORTS=375,1024,1440 AUDIT_THEMES=light,dark AUDIT_ONLY='^imp-registro-' AUDIT_OUT=/tmp/importacao-registro-qa-20260912 npx playwright test apps/web/e2e/responsive-audit.spec.ts --project=chromium-desktop --reporter=list --output=/tmp/importacao-registro-playwright-results
```

Para checklist/produtos/detalhe/cadastro: mesmo comando, `AUDIT_ONLY='^(cert-cadastro|cert-produtos|cert-produto-detalhe|imp-processo-checklist)$'`, quatro testes/24 renders. Documentos/comparativo: outros dois testes/12 renders.

Tentativas anteriores não usadas como gate final: primeiro npm test falhou durante edição concorrente do teste do packing; primeiro pytest encontrou expectativa antiga sendo atualizada; primeiro QA teve HMR e fixtures ausentes. Condições corrigidas e afetados reexecutados. Logs finais em `/tmp/importacao-gate-*.log`; evidências sanitizadas em `output/retomada-2026-09-12/`.

## Encerramento técnico desta rodada

Cronograma relido após atualização final: 7 entregas técnicas concluídas (13,14,17,18,20,21,29),
18 em andamento, 4 bloqueadas (02,03,08,28), 1 a fazer (30). Notas distinguem testes locais,
homologação e publicação; nenhum item técnico concluído representa deploy. Valores, validações
e formato WRAP conferidos pela API do Sheets; não houve inspeção visual autenticada do Sheets.

Riscos remanescentes ALTO: vínculo vigente não homologado, ausência de aplicabilidade oficial
de licenciamento, fonte produtiva ainda e-mail, carga/limpeza Linx não conciliada e extração
visual completa dos pilotos não executada. Nenhuma alegação de sistema 100% homologado.

Próxima revisão proposta: 18/09/2026, com Nicolas, Importação, Certificação e Linx, sujeita a aceite.
Preparar aprovação de regra/vínculos e relatório de carga antes de solicitar deploy; não há
monitoramento ou reunião recorrente configurados nesta sessão.

## Segunda rodada — antecipação autorizada

Em nova orientação, o solicitante autorizou continuar imediatamente e antecipar entregas;
14/09–23/10 deixa de ser janela de execução obrigatória. Cronograma C6 atualizado e relido;
fórmulas e datas originais preservadas como referência. Homologação não depende de aguardar
18/09, mas exige os responsáveis e evidências.

Revisão adicional encontrou e corrigiu problemas que a primeira suíte não cobria:

- PDF: Poppler instalado não era chamado pelo pipeline. Novo helper usa `pdftotext -layout`,
  sem shell, timeout 15 s, buffer 4 MiB, rejeita CMap ausente/texto residual e preserva fallback.
  Testes reais offline recuperaram texto dos três BLs. Packing PK220 recupera 1.375 caixas,
  12.560,68 kg líquidos, 13.997,48 kg brutos e 120,246 CBM com confiança 0,6, sem inferir itens.
- Datas: ETA/ETD/Chegada CD previstos não comprovam evento por terem passado. Inferência usa
  realizado ou status confirmado. Removido fallback ETD → shipmentDate inclusive via summary
  legado; calendário usa São Paulo. Status textual negado/aguardando não confirma evento.
  Número DUIMP sem registro realizado não avança para registrado.
- Comparativo: datas documentais mantêm a regra de consistência/tolerância já aprovada, sob
  rótulo explícito; ETD previsto, embarque realizado, ETA previsto e ETA realizado têm linhas
  separadas. Alteração de identidade dessas linhas exige nova conferência das aceitações antigas.
- Checklist: posições coincidentes mantêm ordem cronológica/id; histórico e comparação Registro
  são invalidados após mutações para não mostrar resultado anterior.
- Registro: arquivos/versões conflitantes, auto-comparação por mesmo arquivo, baixa confiança,
  unidades e moedas incompatíveis não ficam conformes. Unidade ausente exige revisão;
  schema DUIMP e parser espelho leem apenas unidade explícita, sem inferir PCS/UN.
- Certificação: reenvio usa vínculos atuais do lote; item removido não retorna pelo SKU legado.
  Erro posterior não é ocultado pelo primeiro sucesso; conflitos são isolados por marca e inclusão
  serializada com lock existente. Contrato aditivo de restrição individual implementado e testado localmente.

Gateway IA_LOCAL: consulta `/models` falhou por DNS (ENOTFOUND local; EAI_AGAIN no contêiner
produtivo via SSH read-only). Nenhum documento foi enviado nessa verificação. O provider ativo
produtivo é Vertex, diferente do local; não houve troca de provider/egress nem inferência externa.
A extração estruturada completa ainda depende de ambiente de inferência disponível e autorizado.

Os resultados da primeira rodada são históricos para arquivos alterados novamente. Gates da
segunda rodada e migração local serão registrados após estabilização, sem declarar publicação.

## Fechamento da segunda rodada

Estado: **entrega técnica adicional validada, entrega global ainda parcial**. Quatro frentes
congeladas e revisão independente dos riscos Registro/logística/retry realizada. As falsas
conformidades e reaplicação histórica identificadas nesta rodada foram corrigidas, inclusive
aliases contraditórios, duplicata de versão sem hash e outro certificado ativo legado sem itens.

Validação principal do código congelado:

| Comando/verificação                                           | Resultado                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                                           | Passou                                                                       |
| `npm run lint`                                                | Passou                                                                       |
| `npm test`                                                    | API 1.986 passaram, 5 ignorados; web 375 passaram                            |
| `npm run build`                                               | Passou pelo script raiz, NODE_ENV=production; sem aviso de chunk >500k       |
| `python3 -m pytest -q apps/cert-api/tests`                    | 863 passaram                                                                 |
| `python3 -m ruff check apps/cert-api/app apps/cert-api/tests` | Passou                                                                       |
| Prettier dos 69 arquivos de código JS/TS/JSON/CSS afetados    | Passou                                                                       |
| Ruff format dos dois novos testes e sync_runs                 | Passou; formatação preexistente dos demais arquivos Python preservada        |
| `git diff --check`                                            | Passou                                                                       |
| QA navegador adicional                                        | 12 renders finais válidos, sem erros/chamadas sem fixture/overflow de página |

Um render inicial interrompido por HMR foi substituído pela repetição no preview estável.
O principal recontou os JSONs e inspecionou a captura da restrição individual. O build isolado
web do agente teve aviso de chunk; o script raiz final usa NODE_ENV=production e não o reproduziu.
Não somar todos os renders históricos como nova prova do código atual.

Migration `apps/cert-api/sql/20260912_certificate_item_restrictions.sql`: aplicada duas vezes
em PostgreSQL 16 isolado, rede none, tmpfs e sem portas/volumes produtivos. Verificados herança
NULL, constraints, auditoria, isolamento pai/irmão, rollback e compatibilidade de certificado
legado sem itens. Container removido. SHA-256 do SQL conferido pelo principal contra a evidência.
**Aplicar a migration pelo fluxo aprovado antes de publicar esse código.** Não há autoexecução
no startup, nenhuma migration remota foi realizada e não existe licença para carga definitiva.

Cronograma final relido: **8 concluídos tecnicamente, 17 em andamento, 4 bloqueados, 1 a fazer**.
Item22 passou a conclusão técnica; homologação conjunta/carga permanecem27/28. Notas antigas
preservadas e nova rodada anexada. C6 informa execução antecipada; datas originais são referência.

Evidências: `output/retomada-2026-09-12/revisao2/validation-evidence.json` contém hashes dos89
arquivos de código/schema afetados e resultados; `cert-item-migration-evidence.json` documenta
execução SQL; JSONs QA e captura `revisao2/restricao-individual.png` documentam a interface.
Logs executados pelo principal: `/tmp/importacao-r2-final-{typecheck,lint,tests,build,pytest,ruff,format}.log`.

Próximos passos sem aguardar datas: áreas resolverem vínculo vigente/fornecedor e aplicabilidade
licenciamento/dia limite; restaurar gateway IA local ou decidir teste limitado Vertex; executar
homologação dos pilotos com inferência completa; preparar exportação/conciliação e publicação
com migration e configuração corretas. A pergunta sobre Vertex permanece sem resposta nesta
rodada: nenhum documento foi enviado. O catálogo manual e a projeção planilha ainda não têm
resolução automática aprovada por fornecedor. Reordenar etapa já criada não tem controle próprio
na interface; inclusão na posição escolhida, exclusão e ordem estável estão cobertas.

## Auditoria de cobertura e uso efetivo das fontes — terceira rodada

Pedido: confirmar se os 30 pontos, documentos, planilhas e Drive estão sendo utilizados.
Conclusão: **não integralmente em produção**. Fontes foram consultadas nesta sessão e há
implementação local, mas a configuração e o banco implantados continuam anteriores às correções.
Inspeção em 12/09/2026, branch `fix/reuniao-2026-09-11`, HEAD `f4aa948` com diff local.
Consultas remotas somente leitura, exceto atualização autorizada do cronograma e o piloto IA.

O solicitante respondeu **“pode fazer”** ao teste limitado Vertex. Isso substitui a pendência
registrada na rodada2. Foram realizadas quatro inferências com o provider Vertex já configurado
em produção, sem trocar `AI_ALLOW_EXTERNAL=false` local e sem persistir resultados nos bancos.
Detalhes e validações finais desta rodada são registrados abaixo.

### Fontes: consultado não significa integrado

| Fonte                                                                        | Evidência de uso/estado real                                                                             | Lacuna produtiva                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow-up, ID `1fN1Q8KwrSYW55JpWNgQQ61JbS3zg1Ft2OqML6ziwN_Q`, Processos gid0 | ID/aba corretos na API; cabeçalhos e linha1388 lidos. PK219 FOB85.313,93 e ETD07/08 coincidem com banco. | Três pilotos sem `sheetStatusSyncedAt`; PK219 sem ETA realizado/registro/CD realizado, apesar da fonte preenchida.                                                                      |
| Certificação, ID `1qcgcj9814UFikhurgvsTTcUxvPF2r3w_QY_EurvBtSE`              | Abas reais Imaginarium gid0, Puket815522317, Encerramentos1037418503 confirmadas; gid1429080384 é Notas. | Código implantado ainda possui Puket escolares e leitura de Licenciados/Licenciamentos Vencidos; startup chama `sync_licenciados_to_db`. Novos campos Linx e `cert_sync_runs` ausentes. |
| PROCESSOS e quatro subpastas                                                 | Nomes, IDs e parentesco confirmados; PDFs e espelhos reais consultados nos locais corretos.              | `DOCUMENT_SOURCE=email`, `EMAIL_INGESTION_ENABLED=true`, raiz `your-root-folder-id`; IDs de pendentes/espelhos ausentes. 67 documentos:51 legacy+16 manual, **zero com vínculo Drive**. |
| Espelhos PK219/PK220                                                         | Arquivos Sheets nativos em pasta própria, dados/totais lidos.                                            | PK220 não possui espelho associado no banco produtivo. Fonte não pode ser inventada a partir de cache.                                                                                  |
| Linx                                                                         | Metadados e amostras consultados por SELECT nas duas marcas; licenciamento disponível.                   | Sem conciliação/aprovação semântica das propriedades e vínculo vigente. `LINX_WRITE_ENABLED=true` produtivo exige cuidado; nenhuma carga realizada.                                     |
| Capturas locais                                                              | 15 capturas usadas como evidência da reunião nas frentes de revisão.                                     | Captura não substitui PDF original ou teste da tela implantada.                                                                                                                         |
| Cronograma                                                                   | Planilha existente lida/escrita/relida com intervalos precisos.                                          | Estado técnico não representa homologação ou publicação; datas são referência, não impedimento.                                                                                         |

Puket escolares tem **167 registros no banco produtivo** (Imaginarium277/Puket230).
A conciliação anterior de164 SKUs da aba escolares encontrados em Puket confirma cobertura de
códigos na fonte; não confirma migração de vínculo por fornecedor/certificado nem saneamento do banco.

### Confronto dos três pilotos no banco implantado

| Processo    | FOB USD    | ETD        | ETA prevista persistida | ETA realizada / registro | CD previsto persistido |
| ----------- | ---------- | ---------- | ----------------------- | ------------------------ | ---------------------- |
| IM0762607NB | 5.261,76   | 24/08/2026 | 08/10/2026              | ausentes                 | 13/10/2026             |
| PK2192607SZ | 85.313,93  | 07/08/2026 | 17/09/2026              | ausentes                 | 22/09/2026             |
| PK2202608SZ | 101.265,19 | 08/08/2026 | 18/09/2026              | ausentes                 | 23/09/2026             |

PK219 na fonte consultada: ETA realizado08/09, registro04/09, chegadaCD11/09. Não forçar datas
históricas de prints. Documentos produtivos dos pilotos são manuais; todos os BL observados
possuem confiança inferior a90%. `is_processed=true` não comprova leitura utilizável.

### Cobertura dos 30 pontos

“Local” abaixo significa código/testes da branch; nenhum desses resultados equivale a deploy.
Responsáveis continuam os propostos no cronograma, sujeitos ao aceite das áreas.

| ID  | Entrega / estado de cobertura                                                      | Falta para aceite integral                                                                                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 01  | Mapeamento técnico consultado                                                      | Importação/Certificação/Linx aprovar propriedades e direção.                                                  |
| 02  | Dupla certificação parcial; N lida como dado bruto                                 | Área validar preenchimento e vínculo SKU/fornecedor/certificado.                                              |
| 03  | Casos de menor prazo/ausência/fronteira testados localmente                        | Dia inclusivo, não aplicabilidade e vínculo vigente aprovados; regra500 peças pendente.                       |
| 04  | Parser local por cabeçalhos, três abas                                             | Publicar, conciliar fonte/banco e remover consumo produtivo escolares/licenciamentos antigos.                 |
| 05  | Status/validade/fim de venda separados localmente                                  | Homologar Vitrola/Karaokê/Mozi/Bicho Machine/Nevinho com vínculo correto.                                     |
| 06  | Leitura Linx local implementada; SELECT real comprovado                            | Reconciliação por SKU/marca; semântica/grife/aplicabilidade aprovadas.                                        |
| 07  | Menor prazo válido coberto localmente                                              | Confirmar consolidação real em FIM_VENDAS nas duas marcas.                                                    |
| 08  | Carga não executada; revisão encontrou proteção insuficiente antes de apply        | Baseline persistida, comparação, aprovação e restauração demonstradas antes de escrever.                      |
| 09  | Ingestão Drive local implementada e pastas reais acessíveis                        | Ativar configuração/migração corretas e homologar descoberta/deduplicação em operação.                        |
| 10  | Parser e piloto real limitado invoice/packing parcial                              | Completar extração integral dos três processos, fabricantes/importador e conciliação por campo.               |
| 11  | Corte90 preservado; três BL reais usados no piloto                                 | Resolver limitações de leitura/verificação sem tornar campos ausentes conformes.                              |
| 12  | Precedência/origem da capa local                                                   | Homologar três capas durante processamento e entre sessões reais.                                             |
| 13  | CNPJ exato/SKU textual cobertos localmente                                         | Conciliar SKU050404509 com identificador realmente publicado no packing/espelho.                              |
| 14  | Filtros/contagens sobre mesmas linhas localmente                                   | Reconstruir caso histórico39vs34; estado adicional não verificado deve permanecer explícito.                  |
| 15  | Colunas/correspondência local; cache espelho sem arquivo corrigido nesta rodada    | Homologação integral por campo e consulta real Odoo.                                                          |
| 16  | Datas previstas/realizadas separadas localmente                                    | Sincronizar e conferir registros já persistidos com fontes oficiais.                                          |
| 17  | Cabeçalho validado em browser375/1024/1440 claro/escuro                            | Publicação e aceite visual das analistas.                                                                     |
| 18  | Checklist **parcial**: inserir na posição/remover por processo funciona            | Mover etapa já existente não tem controle UI; alteração global de etapas antigas precisa confirmação da área. |
| 19  | Comparação DUIMP/espelho/invoice local                                             | PDFs reais disponíveis são extratos versão0001; falta rascunho e mapeamento comercial de SKU.                 |
| 20  | Analista autenticado pode remover associação local; editar/reprocessar preservados | Homologar perfil real; operação não exclui arquivo físico no Drive.                                           |
| 21  | Fim venda separado e validações locais                                             | Publicar/homologar cadastro sem sobrescrever licença oficial.                                                 |
| 22  | Lote/individual e restrição histórica locais com SQL testado isolado               | Aplicar migration pelo fluxo aprovado e homologar vínculos reais.                                             |
| 23  | Campos e exportação separados; cobertura parcial                                   | Mesmo snapshot UI/relatório, dupla certificação e projeção de cadastro manual.                                |
| 24  | Atualização real Sheets+Linx e agenda horária no código local                      | Publicar schema/rotina e provar alteração conhecida→atualização→mesmo SKU.                                    |
| 25  | Inventário público173 terceiros executado sem persistência                         | Aplicabilidade validada e cobertura/paginação completa; número publicado não prova autenticidade.             |
| 26  | Redução de ruído local implementada                                                | Lembrete reaparece após5 dias úteis sem mudança; validar frequência com equipe, sem envio nesta auditoria.    |
| 27  | Testes locais, fontes reais e piloto IA limitado                                   | E2E integrado, perfis, reprocessamento e aceite conjunto dos três processos/casos comerciais.                 |
| 28  | Não liberado                                                                       | Carga conciliada, aceite das áreas, publicação e acompanhamento da primeira execução.                         |
| 29  | Cronograma atualizado ao solicitante                                               | Compartilhamento no grupo permanece com Mats; nenhuma mensagem enviada.                                       |
| 30  | Revisão semanal proposta                                                           | Sem agenda recorrente criada nem reunião/aceite executados pelo agente.                                       |

### Sequência para ativação e carga

1. Concluir/revisar diff e gates locais; preservar alterações preexistentes.
2. Resolver vínculo vigente, propriedade comercial Linx, aplicabilidade e dia limite com áreas.
3. Preparar revisão Git e fluxo aprovado de publicação: deploy exige master limpo e sincronizado;
   branch atual contém alterações não publicadas. Não executar script parcialmente ou ignorar gates.
4. Aplicar todas as migrations pendentes (incluindo hash/ingestão e contrato cert individual),
   validar schema, configurar IDs reais Drive e desativar e-mail. Conferir também flags produtivas
   de escrita/sync antes de iniciar serviços que possam escrever no Linx.
5. Exportar baseline privada por SKU/marca/cor/propriedade com valores originais de licenciamento;
   registrar versão da fonte, comparar proposta e duplicatas/ausentes. Nenhuma data sem vínculo
   pode entrar em carga. Gate: zero escrita de licenciamento, zero vínculo ambíguo aprovado implicitamente.
6. Homologar lote delimitado aprovado, comparar antes/depois e comprovar recuperação preservando
   alterações concorrentes. Somente então ampliar carga e acompanhar primeira execução.

A skill `safe-backfill-and-replay-orchestration` exige plano revisado e recuperação antes de replay;
esta sequência ainda não é autorização técnica para aplicar uma carga sem baseline conciliada.
Não houve migration remota, carga Linx, publicação, mudança das fontes ou envio ao chat.

### Piloto Vertex e correções confirmadas

Quatro chamadas `gemini-2.5-flash`, sem retries, timeout180s/call e sem persistência de dados
extraídos no banco. 18.951 tokens de entrada/7.720 saída, custo estimado US$0,0249853 (não é
conciliação de faturamento). PDFs e respostas integrais permanecem em diretório temporário
privado; somente evidência sanitizada em `output/retomada-2026-09-12/revisao3/vertex-pilot-summary.json`.

| PDF real      | Confiança efetiva após correções | Valores independentes conferidos                                |
| ------------- | -------------------------------- | --------------------------------------------------------------- |
| IM076 BL      | 96,70%                           | 42 caixas /399kg /1,432CBM                                      |
| PK219 BL      | 95,45%                           | 699caixas /5.941,50kg /65,527CBM /embarque07/08/2026            |
| PK220 BL      | 96,04%                           | 1.375caixas /13.997,48kg /120,246CBM /embarque08/08/2026        |
| PK220 packing | 89,61%                           | 1.375caixas /12.560,68kg líquido /13.997,48kg bruto /120,246CBM |

**4 schemas válidos e15/15 valores esperados conferidos.** Packing:14itens, quantidade90.615;
SKU050404509 recuperado da descrição explícita, preservando50404509 da coluna fonte. Corte90
é específico de BL. Passar nesse corte não valida campos ausentes, cadastro de fornecedor,
comparativo ou liberação comercial. ETD/ETA/emissão ausentes permanecem null.

Causas corrigidas e verificadas sem repetir inferência:

- Poppler retornava letras/dígitos fullwidth; NFKC normaliza somente representação extraída,
  sem alterar PDF. Antes disso, identificadores impressos eram classificados como ausentes.
- Harness penalizava HS4/6 literal permitido e fornecedor novo literal como erro de leitura.
  Avisos continuam, sem desconto de confiança nesses casos. HS truncado de NCM8 ou fornecedor
  sem apoio literal continua penalizado; corte90 e penalidade de erro permanecem.
- Comparativo geral aceitava cache de espelho sem arquivo. Agora apenas documento associado
  válido fornece valores; override órfão não restaura a fonte e confiança0,99 artificial saiu.
- Carga bulk podia chegar à escrita antes de persistir baseline. Apply local agora bloqueia
  antes de ler/escrever, mesmo com flagtrue; dry-run preservado, falha ao salvar relatório é erro.
  Leitores de preparação usam parser estrito. É proteção temporária, não carga implementada/homologada.
- Excel não substitui mais licença ausente do snapshot por leitura ao vivo silenciosa; derivação
  usa mesmo snapshot da tela, com evidência Linx separada.

Denominador de confiança vigente, não alterado: campos preenchidos +0,25×campos ausentes,
com numerador soma das confianças de campos preenchidos. BL tem25wrappers; denominadores
22,75/22/22,75. Packing144wrappers (99 preenchidos,45 ausentes), denominador110,25. Harness
aplica teto por problemas de leitura; aviso informativo comprovado não reduz leitura. Essa
métrica não é percentual de exatidão de todos os campos;15 valores foram conferidos independentemente.

Cronograma atualizado e **32 células relidas com correspondência exata**:7 concluídos técnicos,
18 em andamento,4 bloqueados,1 a fazer. Item18 reaberto como parcial; notas preservam histórico.
Nenhuma estrutura, fórmula ou dados das planilhas-fonte foram alterados.

### Fechamento dos gates da terceira rodada

Código congelado e revisado pelo principal: **todos os gates abaixo passaram**.

| Comando                                                       | Resultado                                         |
| ------------------------------------------------------------- | ------------------------------------------------- |
| `npm run typecheck`                                           | passou API/web                                    |
| `npm run lint`                                                | passou                                            |
| `npm test`                                                    | API2.000 passaram/5ignorados; web375 passaram     |
| `npm run build`                                               | passou; build raiz production                     |
| `python3 -m pytest -q apps/cert-api/tests`                    | 873 passaram                                      |
| `python3 -m ruff check apps/cert-api/app apps/cert-api/tests` | passou; condição aninhada ajustada pelo principal |
| `npx prettier --check` nos72 arquivos JS/TS/JSON/CSS afetados | passou                                            |
| `git diff --check`                                            | passou                                            |

Manifesto SHA-256 dos arquivos de código atuais e logs em
`output/retomada-2026-09-12/revisao3/validation-evidence.json`. Logs completos em
`/tmp/importacao-r3-final-{typecheck,lint,tests,build,pytest,ruff,format}.log`.
Não houve alteração UI nesta terceira rodada; não foi repetido navegador. Os renders da rodada2
continuam evidência do escopo visual então verificado, não do fluxo produtivo integrado.

Estado final: **auditoria dos30 pontos concluída; correções desta rodada validadas localmente;
entrega global parcial e produção ainda anterior**. Fontes consultadas não equivalem a fontes
consumidas pela aplicação implantada. Próximo passo: fechar contrato comercial e lote/baseline
revisável, preparar publicação no fluxo Git/migrations/configuração aprovado, homologar ponta a
ponta com áreas e somente então aplicar carga conciliada. A autorização Vertex foi executada.

## Quarta rodada — revisão profunda e preparação de deploy

Usuário autorizou continuar melhorias e publicar após revisão. Quatro frentes independentes
revisaram Drive/documentos, Registro, certificação e interface; root revisou fluxo de release.
Correções adicionais: seleção de versão sem fallback antigo, concorrência/limite real de arquivo
Drive, reordenação de checklist, falha explícita de inventário marketplace parcial, CORS PATCH e
verificação de schema antes do startup. Evidências finais serão vinculadas ao candidato integrado.

Deploy passa a construir imagens antes das migrations, aplicar CLI explícita de certificação,
impedir publicação sem snapshot recuperável e recuperar código também em falha de certificação,
proxy ou restart. Snapshot anterior permanece disponível durante observação inicial. Não há
rollback automático de banco; migrations são aditivas e testadas isoladamente.

Configuração candidata cifrada foi preparada sem alterar runtime: Drive como fonte, e-mail
inativo, IDs reais PROCESSOS/PENDENTES/ESPELHOS, Drive somente leitura, fonte de referência
follow-up, FOLLOW_UP_SYNC_MODE=dry_run e LINX_WRITE_ENABLED=false. Aplicação geral do follow-up
continua dependente de conciliação para não sobrescrever valores manuais/documentais. SYDLE
está previamente ativo e fora das alterações desta entrega; o gate de rollout exige autorização
explícita para manter essa integração ativa durante publicação. Nenhuma credencial foi exposta.

### Decisão comercial recebida durante preparação

Solicitante confirmou em12/09: **venda permitida até o fim do dia limite em São Paulo**.
Bloqueio inicia no dia seguinte; testes da regra inclusiva permanecem aplicáveis. Esta decisão
substitui todas as pendências históricas de inclusividade neste relatório. Não resolve vínculo
vigente/fornecedor, não aplicabilidade de licenciamento ou autorização de carga conciliada.

### Revisão operacional das quatro frentes (somente leitura)

- Drive:3 pilotos encontrados,18 candidatos (12PDF/6XLSX). 16 arquivos legados acessíveis;
  9PDFs idênticos por SHA-256 aos manuais semhash. Deduplicação em memória evita reimportação
  desses bytes, sem backfill. PK219/PK220 em Puket/2027/HIGH SUMMER,IM076 em Pendentes;
  espelhos oficiais v25/v93,IM076 ausente. Dois OHBL diferentes no PK220 mantêm proveniência.
- Linx: NevinhoPI6552Y tem8325/2022 encerrado de Toyland e10473/2024 ativo de Ruifutong;
  trava29/10/2026 corresponde ao antigo e N está vazia. VitrolaPI5555Y ativo apresenta22/03/2027
  na propriedade/trava. KaraokêPI5558Y ativo com validade27/07/2028 apresenta trava27/07/2026.
  MoziPI5914Y eBicho990400023 conciliam prazos29/10/2026 e20/11/2027. Licenças ausentes/1900
  não provam nãoaplicabilidade. SKU050404509 tem propriedades1900,mas FIM_VENDAS05/11/2030;
  outras fontes dessa data devem ser esclarecidas pelo Linx antes de recomputar.
- Registro/Odoo: hostname configurado é **your-odoo-instance.com**,igual exemplo do projeto.
  Falha de DNS não comprova ERP realoffline. É necessário endpoint/base/conta oficiais via
  configuração segura. PDFs DUIMP disponíveis PK219/PK220 são extratos0001 desembaraçados,
  não rascunhos; catálogo2373 não equivale aoSKU050404509 e unidade estatística não substitui
  unidade comercial. IM076 sem DUIMP no conjunto disponibilizado.
- Autorização: corrigido gateway que devolvia403 aoanalista noPATCH exato da restrição individual;
  demais métodos/caminhos permanecem restritos. Movechecklist verifica processo+etapa; documentos
  verificam processo associado; proxy transmite ator confiável. Modelo compartilhado por equipe,
  não há contrato de ACL porcriador/marca demonstrado. Ensaios comperfilreal permanecem UAT.

Artefatos operacionais sanitizados preservados fora do Git; resultados resumidos acima não são
aprovação de carga ou de liberação comercial. Odoo faltante e rascunhos/vínculos ausentes devem
permanecer pendentes na interface. Nenhuma fonte foi modificada por essas consultas.

### Candidato integrado para publicação

Integração preserva origin/master955d6a8 e revisão5bf2fd0 em worktree isolado. Conflitos foram
resolvidos por área e duplicação de declaração detectada no typecheck foi corrigida antes da
publicação. Acrescentadas proteção de hash legado, permissão PATCH exata paraanalistas e trilha
sanitizada de ator no retry Linx (logs de início/resultado/falha, sem mensagens ERP ou secrets).

Gates finais de testes: API2.045 passaram/5ignorados; web379 passaram; cert-api888 passaram.
Typecheck e lint passaram; oito testes de deploy passaram, incluindo snapshot parcial, falhaSSH,
readiness e renderização atômica. Browser:18renders finais em3cenários,3larguras,2temas;0erros,
0requests semfixture. Build final passou; hook de commit será confirmado no registro de publicação.

Publicação proposta: versão integrada na master pelo scripts/deploy.sh, backup obrigatório,
construção de imagens antes deDDL, migrationsAPI+CLIcert, healthAPI/cert/web/proxy e snapshot
retido. GOOGLE_CHAT_WEBHOOK_URL será removido apenas do ambiente do comando de deploy para
não enviar notificação ao grupo. SYDLE já está ativo em produção e será preservado mediante
autorização exigida pelo gate; Linx fica sem escrita,Drive sem escrita,e-mail semingestão,
follow-up semaplicação geral. Nenhuma carga financeira está incluída nesta publicação.

## Encerramento solicitado — 12/09/2026 (estado final desta sessão)

Este registro substitui pendências anteriores de autorização: o solicitante autorizou explicitamente push, preservação do SYDLE e deploy. Pediu em seguida encerrar a sessão e preservar a retomada.

- **Push concluído:** origin/master em `c0e923474cb32f6e4df6fa0ce49fd6e102d90d85`. Branch local `fix/reuniao-2026-09-11`; worktree de release `/tmp/importacao-release-20260912`, master limpa em c0e9234. Não houve deploy, migration remota ou carga Linx. O runtime de produção continua anterior à revisão.
- **Bloqueio observado:** [CI 34693884581](https://github.com/nmatss/importacao/actions/runs/34693884581), job Security Audit Node, `npm audit --audit-level=high`, exit 1: 3 vulnerabilidades altas (js-yaml, multer, nodemailer) e 5 moderadas. Auditoria local confirmou os totais. Demais jobs ainda estavam em andamento na última consulta; [CodeQL](https://github.com/nmatss/importacao/actions/runs/34693884558) também deve ser consultado na retomada. Nenhuma correção de dependências foi aplicada após o pedido de encerrar.
- **Evidências locais válidas para o código c0e9234:** API 2.045 passaram/5 ignorados, web 379, cert-api 888; typecheck, lint, build e Ruff passaram; 8 testes do deploy passaram; 18 renders finais sem erros. Hook real de commit passou ESLint (163 arquivos TS) e Prettier (180 arquivos); apenas linhas em branco de três documentos mudaram após os gates.
- **Decisões/autorização preservadas:** venda permitida até fim do dia limite em America/Sao_Paulo; teste limitado Vertex autorizado e quatro chamadas já executadas; push, manutenção do SYDLE e deploy autorizados. Não pedir essas autorizações novamente. Carga Linx depende de homologação/conciliação; fontes e licenciamento não foram alterados; envio ao grupo permanece com Mats.
- **Retomada imediata:** verificar estado Git e CI; corrigir dependências vulneráveis de forma focada, revisar impacto e repetir gates afetados. Com CI aprovado, integrar/push e executar `scripts/deploy.sh` em master limpa e sincronizada, com backup obrigatório, `ALLOW_SYDLE_SYNC_DEPLOY=1` e `GOOGLE_CHAT_WEBHOOK_URL` removido apenas do ambiente desse comando. Não usar bypass de auditoria ou de backup. Migrations explícitas API/cert são parte do fluxo aprovado; rollback de código usa snapshot e não desfaz DDL.
- **Pendências de negócio/homologação:** vínculo vigente/fornecedor, validação de dupla certificação na coluna N, aplicabilidade do licenciamento, baseline/carga conciliada e aceite das áreas; Odoo tem endereço placeholder; PDFs DUIMP disponíveis são extratos finais, faltam rascunhos reais. Dia limite deixou de ser pendência. Regra de 500 peças continua sem aprovação. Matriz dos 30 pontos e resultados por fonte estão nas seções anteriores deste documento.
- **Preservação:** arquivos preexistentes não rastreados `apps/web/e2e/_offenders.spec.ts`, `apps/web/e2e/_shot.spec.ts` e `output/` mantidos. Evidências sanitizadas em `output/retomada-2026-09-12/revisao4/`; PDFs/respostas privadas permanecem fora do Git. Os logs temporários citados podem desaparecer: os resultados essenciais estão neste checkpoint.
- **Memória e cronograma:** ai-memory confirmou página `decisions/certificacao-venda-dia-limite-2026-09-12.md` e handoff `01a0959c-ac9b-7f50-880b-c3e0e813bb07`; dotcontext recebeu checkpoint de pausa na sessão `11eb5436-440b-4a2d-bd6c-2bf5e9267a8f`. Cronograma atualizado nas notas de `Cronograma!E37` e `'Escopo e aceite'!F32`, mantendo bloqueio da liberação e preservando histórico. Não foi configurada continuação automática, reunião recorrente ou publicação automática.

## Retomada R5 — desbloqueio de CI

Inspeção de 12/09/2026: checkout `41fa789`, origin/master `c0e9234`; worktree temporário anterior ausente. Produção consultada por SSH ainda em `955d6a8`, serviços saudáveis. Autorizações de push, SYDLE e deploy confirmadas pelo pedido de retomada; fontes, colunas e carga Linx permanecem protegidas.

O CI 34693884581 terminou com dois bloqueios: auditoria Node e E2E Documents (400 recebido versus 409 esperado). CodeQL 34693884558 passou. A causa do E2E era expectativa anterior ao contrato de `MANUAL_UPLOAD_ENABLED`: fonte Drive não desativa upload manual. O teste agora configura a flag explicitamente, verifica bloqueio antes de multipart inválido e validação de arquivo ausente quando habilitada. Nenhuma regra da aplicação foi alterada nesta rodada.

Dependências corrigidas: Multer 2.3.0, Nodemailer 9.1.1 (incluindo override), js-yaml 4.3.2, Vitest/coverage 4.1.11 e transitivas da família de testes. Riscos anteriores: ALTO para negação de serviço em Multer/Nodemailer/js-yaml; MEDIO para leitura arbitrária no mocker e dependentes. A auditoria atual retornou zero vulnerabilidades. Fontes oficiais: [Multer](https://github.com/expressjs/multer/releases/tag/v2.3.0), [Nodemailer](https://github.com/nodemailer/nodemailer/releases), [Vitest](https://github.com/vitest-dev/vitest/releases).

Validações locais no diff R5:

| Comando                                                                                                                                   | Resultado                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm ci` com Node 22.23.1 / npm 10.8.2                                                                                                    | passou, zero vulnerabilidades; prepare/Husky executado                        |
| `npm audit --audit-level=high`                                                                                                            | passou, zero vulnerabilidades                                                 |
| `npm run typecheck`                                                                                                                       | passou API/web                                                                |
| `npm run lint`                                                                                                                            | passou                                                                        |
| `npm test`                                                                                                                                | API 2.045 passaram / 5 ignorados; web 379 passaram                            |
| `CI=true npm run test:e2e -w apps/api`                                                                                                    | 74 passaram em 9 arquivos, PostgreSQL 16 efêmero; sem skips de infraestrutura |
| `npm run build`                                                                                                                           | passou API/web                                                                |
| `npx prettier --check package.json package-lock.json apps/api/package.json apps/web/package.json apps/api/test/e2e/documents.e2e.test.ts` | passou                                                                        |
| `python3 -m pytest -q apps/cert-api/tests`                                                                                                | 888 passaram                                                                  |
| `python3 -m ruff check apps/cert-api`                                                                                                     | passou                                                                        |
| `python3 scripts/test-deploy-release.py`                                                                                                  | 8 passaram                                                                    |
| `python3 scripts/test-generate-env.py`                                                                                                    | 4 passaram                                                                    |
| `python3 scripts/test-trivy-secret-config.py`                                                                                             | passou                                                                        |
| `git diff --check`                                                                                                                        | passou                                                                        |

O npm 10 falhou internamente em `edgesOut` ao resolver os peers da atualização. O lockfile foi gerado com npm 11.19.0 já disponível e consumido normalmente por `npm ci` no Node 22/npm 10; não houve bypass de peers, auditoria ou hooks. Logs de testes em `/tmp/importacao-r5-{tests,e2e,pytest}.log`; os totais acima preservam as evidências essenciais.

Configuração cifrada candidata conferida sem expor credenciais: DOCUMENT_SOURCE=drive, DRIVE_WRITE_MODE=off, FOLLOW_UP_SYNC_MODE=dry_run, LINX_WRITE_ENABLED=false, SYDLE_SYNC_ENABLED=true. MANUAL_UPLOAD_ENABLED ausente mantém o padrão true aprovado. Rede ia-local-net, SOPS/age e espaço em disco remoto verificados. Nenhum deploy desta rodada realizado neste checkpoint; publicação depende do novo CI completo.

Dotcontext retomado na sessão existente; checkpoints acompanham R5-A dependências, R5-B E2E, R5-C gates/CI e R5-D deploy. PREVC continua com limitação histórica de associação do plano: estado de fase não comprova aceite. ai-memory retornou a memória pertinente na busca, mas a leitura por caminho resolveu outro projeto; nenhuma gravação foi feita nesse escopo inconsistente. Homologação comercial, N/vínculo/fornecedor, licenciamento, Odoo oficial e rascunhos DUIMP seguem pendentes. Não há alegação de homologação integral ou de carga conciliada.

### R5 — segunda iteração: base Debian da certificação

Commit `47a2d33` publicado. [CI 34715522926](https://github.com/nmatss/importacao/actions/runs/34715522926) passou testes, E2E, lint, auditorias Node/Python, builds das três imagens e scans Trivy API/web; falhou no Trivy cert-api com 12 CVEs corrigíveis da base Debian (9 ALTO, 3 CRITICO). [CodeQL 34715522953](https://github.com/nmatss/importacao/actions/runs/34715522953) passou. Nenhum deploy foi iniciado.

Causa: o runtime instalava suas dependências sem atualizar pacotes herdados de `python:3.12-slim`. `apps/cert-api/Dockerfile` agora executa `apt-get upgrade -y --no-install-recommends` no estágio final. Não altera a versão principal Python, código funcional, fontes ou dados. A nova imagem local foi construída com `docker build --pull -t importacao-cert-api:r5-security apps/cert-api` e carrega Oracle thick client, pymssql, psycopg2, SQLite e FastAPI sem rede, como UID 1001.

Versões verificadas na imagem: gzip `1.13-1+deb13u1`, libpcre2-8-0 `10.46-1~deb13u2`, libsqlite3-0 `3.46.1-7+deb13u2`, perl-base `5.40.1-6+deb13u1`. Correções confirmadas no Debian Security Tracker: [gzip](https://security-tracker.debian.org/tracker/CVE-2026-41992), [PCRE2](https://security-tracker.debian.org/tracker/CVE-2026-86145), [SQLite](https://security-tracker.debian.org/tracker/CVE-2026-11822), [Perl](https://security-tracker.debian.org/tracker/CVE-2026-13221).

O preflight HTTPS padrão recusou a CA interna no WSL e no servidor. O certificado raiz público foi obtido do contêiner `internal-ca` por SSH autenticado; frontend e `/api/health` retornaram 200 usando `curl --cacert`, sem desativar TLS ou alterar trust stores. O endpoint público `/api/health/live` retornou 404 e não é usado como evidência de readiness; a revisão será conferida pela rota direta `/health/live` da API.

Trivy local 0.74.0, com base atualizada em cache isolado, passou: `trivy --cache-dir /tmp/importacao-r5-trivy-cache image --no-progress --secret-config trivy-secret.yaml --ignorefile .trivyignore --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --format json --output /tmp/importacao-r5-cert-trivy.json importacao-cert-api:r5-security`. Zero achados HIGH/CRITICAL corrigíveis e zero secrets reportados; nenhuma exceção adicionada. Build, smoke dos drivers, Prettier dos documentos e `git diff --check` passaram. Gates de aplicação da revisão anterior continuam válidos para os mesmos arquivos; novo CI completo verificará a imagem corrigida antes do deploy.

### R5 — entrega técnica implantada e verificada

**Release `4eafface1b68e7cbbaf2b5802f35592d187b57e5` em produção desde 12/09/2026, 17:21:50 BRT.** [CI 34716201043](https://github.com/nmatss/importacao/actions/runs/34716201043) e [CodeQL 34716201050](https://github.com/nmatss/importacao/actions/runs/34716201050) concluídos com sucesso para essa revisão. CI aprovou os testes, auditorias, builds, três scans Trivy e três SBOMs. Hooks reais dos dois commits passaram; nenhuma exceção de segurança adicionada.

Execução em master limpa e sincronizada no worktree `/tmp/importacao-release-20260912`:

```bash
env -u GOOGLE_CHAT_WEBHOOK_URL SKIP_BACKUP=0 ALLOW_SYDLE_SYNC_DEPLOY=1 \
  DEPLOY_USER=nicolas DEPLOY_DIR=/home/nicolas/importacao \
  COMPOSE_FILE=docker-compose.prod.yml \
  CURL_CA_BUNDLE=/tmp/importacao-internal-ca-public.crt \
  PUBLIC_WEB_HEALTH_ENDPOINT=https://importacao.grupounico.com/ \
  bash scripts/deploy.sh 192.168.168.124
```

O prompt do script foi confirmado dentro da autorização já concedida. Exit 0. Backup `/home/nicolas/backups/importacao/importacao_2026-09-12_201810.pgdump`, 2,7 MB, verificado por `pg_restore --list`; isso não substitui ensaio completo de restauração. Volumes arquivados pelo script; snapshot de código anterior retido em `/home/nicolas/importacao.rollback`. Imagens construídas antes das migrations; migrations API e CLI cert aplicadas/verificadas. Rollback de código não desfaz DDL. Logs anteriores arquivados, observabilidade reiniciada e readiness API/cert/web/proxy/HTTPS aprovada. Log local: `/tmp/importacao-r5-deploy.log` e `deploy.log` no worktree de release.

Pós-deploy:

- `REVISION` remoto e `/health/live` direto da API confirmam `4eaffac`; API/web/cert/PostgreSQL/Redis saudáveis. CLI cert `python -m app.db.release_migrations --check` passou.
- `docker exec importacao-api node scripts/smoke-integrations.mjs --network`: resumo operacional aprovado; Gmail perfil, SMTP transporte, Drive raiz e follow-up acessíveis, 1.415 referências. Nenhuma mensagem enviada pelo smoke. IMAP recusou autenticação, falha já registrada, fora do fluxo ativo de ingestão.
- Flags conferidas nos contêineres: DOCUMENT_SOURCE=drive, DRIVE_WRITE_MODE=off, FOLLOW_UP_SYNC_MODE=dry_run, SYDLE_SYNC_ENABLED=true, EMAIL_INGESTION_ENABLED=false, LINX_WRITE_ENABLED=false. Nenhuma carga Linx ou escrita nas fontes foi executada nesta retomada. Provider observado em `/health/live`: vertex; nenhum novo piloto de inferência foi executado nesta sessão.
- HTTPS com CA interna: raiz, theme-init e quatro assets JS/CSS principais retornaram 200; proxy `/api/health` 200; `/api/auth/me`, `/api/processes` e `/cert-api/products` sem autenticação retornaram 401. HTTP redireciona 301 para HTTPS. CSP e X-Content-Type-Options presentes; HSTS ausente no endpoint público, registrado como pendência BAIXO de configuração do edge. Não foi alterada infraestrutura de certificados/trust store.
- Smoke HTTP inicial tinha uma premissa incorreta de que todo stylesheet era local; foi ajustado para distinguir Google Fonts. Esse erro era do procedimento de verificação, sem mudança na aplicação. Google Fonts e navegador/fluxos autenticados reais não foram revalidados nesta rodada; a evidência de UI anterior continua limitada às fixtures então testadas.
- Cronograma atualizado somente nas **notas** de `Cronograma!E37` e `'Escopo e aceite'!F32`, com releitura e igualdade exata do texto gravado; valores, validação e formatação preservados. `Bloqueado` permanece correto para liberação global. Não houve envio ao grupo.

R5-A/B/C/D concluídas no escopo técnico de correção, CI e deploy. **Entrega global permanece parcial**: aceites das áreas, vínculo vigente/fornecedor/N, aplicabilidade do licenciamento, Odoo oficial, rascunhos DUIMP e baseline/carga conciliada continuam pendentes. Não declarar o projeto 100% homologado. Próximo passo é obter essas evidências e homologar os fluxos autenticados antes de qualquer carga Linx. Checkpoint e artefato sanitizado atualizados no dotcontext e em `output/retomada-2026-09-12/revisao5/`; ai-memory não recebeu escrita devido à resolução inconsistente de projeto.

# Certificação — sync da planilha parado de 12/09 a 18/09/2026

Retomada da frente de certificação em 18/09/2026, a partir de três sinais do time:

- Lilian (Projetos), 17/09 09:53: "Não está trazendo o relatório" — print da tela Produtos com
  Certificação = Encerrado e Licenciamento = Vencido, zero resultados e um aviso vermelho pequeno.
- Lilian, 17/09 11:14: "essa parte você chegou a verificar?" — sobre cadastrar, pela tela, uma
  lista de produtos com as respectivas datas, sem depender da TI.
- Elisangela (Linx), 16/09: propriedades Imaginarium 00106/00107 e Puket 00224/00225.

Branch local: `fix/cert-sync-quarentena-2026-09-18`. Nada publicado nem implantado nesta rodada.

## 1. O que estava acontecendo (fatos medidos em produção, somente leitura)

| Fato                                                                        | Evidência                                   |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| 145 de 145 execuções do sync falharam desde 12/09 20:21Z                    | `cert_sync_runs`, todas com o mesmo `error` |
| Motivo real: `Vinculo de certificacao ambiguo; validar fornecedor e ...`    | `result.sheets.error` e log do job horário  |
| 0 produtos sincronizados por execução                                       | `result.sheets.synced = 0`                  |
| `validade_certificado` NULL em 674 de 674 produtos                          | `cert_products`                             |
| Nenhuma leitura do Linx: `linx_synced_at`, grife, licenciamento, fim vendas | 0 de 674 preenchidos                        |
| 167 produtos ainda com marca "Puket Escolares"                              | `cert_products.brand`                       |
| PI6552Y (Nevinho, ativo) ainda com o prazo 29/10/2026 do certificado antigo | `sale_deadline_date`                        |

Ou seja: a release de 12/09 (R5–R7) publicou o código novo, mas ele **nunca conseguiu rodar um
sync**. Tudo o que Eduarda e Letícia apontaram na reunião de 11/09 continuou visível em produção, e
a tela da Lilian estava vazia porque o licenciamento nunca foi lido — não porque não houvesse
produto vencido.

## 2. Causa raiz

Duas guardas em `apps/cert-api/app/services/erp_service.py` abortavam o sync **inteiro** por causa
de problema de **um SKU**:

1. `_read_ativos_from_sheets(strict=True)`: SKU com mais de um fornecedor/certificado entre as
   linhas candidatas → `raise`.
2. `sync_sheets_to_db`: SKU cujo certificado na aba da marca difere do de "Encerramentos" →
   `return {"synced": 0, "error": ...}`. Esse é exatamente o caso de **dupla certificação**, que a
   reunião de 11/09 já tinha decidido ("vale o ativo") e que `resolver_encerramentos` já tratava.

Medição na planilha real em 18/09: **21 SKUs travavam 962 linhas.** A guarda 1 pega 4 SKUs, todos
com dois certificados encerrados e nenhum ativo (PI4368Y, PI6014Y, 100400422, 100400423). A guarda 2
pega 17, dos quais 15 com o certificado novo ATIVO. A coluna "Dupla certificação?" segue vazia nas
402 linhas.

Por que passou pela homologação de 12/09: dois testes **afirmavam o aborto** como comportamento
correto (um deles, `test_encerramento_de_sku_ativo_nao_e_gravado`, tinha nome e docstring dizendo o
contrário do corpo). A suíte verde e o smoke pós-deploy (`/api/ready` = 200) não exercitam a
planilha real. E o aviso da tela mostrava só o resumo "Sincronizacao da planilha falhou; etapa Linx
nao executada" — o motivo acionável ficava escondido em `result.sheets.error`, então ninguém sabia o
que corrigir.

Agravante: `sync_runs.run_sheet_sync` pulava a leitura do Linx quando a planilha falhava, embora essa
leitura só dependa dos SKUs já gravados em `cert_products`.

## 3. O que foi corrigido pelo orquestrador

| Commit    | Mudança                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `8d191a7` | Vínculo ambíguo vira **pendência por SKU**; dupla certificação com ativo deixa de ser erro; aviso mostra o motivo real e os SKUs pendentes                                                                                           |
| `e6dd9a3` | Linx é lido mesmo com a planilha em erro; EAN sem tradução não libera o SKU real; todos os cabeçalhos do layout obrigatórios; contagem de prazos ilegíveis; motivo acionável no 502; alerta no topo e vazio honesto na tela Produtos |
| `14379fa` | Unlock do lock de sessão que falha fecha a conexão (evita "já em andamento" eterno)                                                                                                                                                  |

Decisões embutidas, todas reversíveis e só de exibição (a escrita no Linx segue desligada):

- SKU pendente **sincroniza** pela regra determinística (`_linha_vigente`) e é listado; não fica
  congelado. Removê-lo do sync o tiraria da lista protegida da limpeza e apagaria o bloqueio dele.
- SKU sem linha ativa com certificado divergente mantém o prazo do encerramento (lado conservador).
- A preparação da **carga do Linx** (`read_situacao_por_sku`) continua recusando tudo — agora
  nomeando os SKUs. Esse portão é de negócio e não foi afrouxado.
- Problema de **esquema** (cabeçalho ausente/duplicado) continua abortando: é da aba, não de um SKU,
  e abortar preserva o último snapshot bom.

## 4. Evidências

- Os 4 testes novos/ajustados do P0 **falham no código antigo** e passam no corrigido (mutação por
  `git stash`).
- cert-api: 898 testes (base 888), `ruff check` limpo. Web: typecheck e ESLint limpos; 31 testes em
  `CertProdutosPage`.
- **Dry-run sem escrita, dentro do container de produção, com o código final contra a planilha
  real** (banco substituído por um gravador): `synced 947` (566 ativos + 381 encerramentos), 5
  pendências, 0 EAN pendente, 0 prazo ilegível; validade preenchida em 541 de 566; PI6552Y ativo com
  validade 21/04/2027 e **sem** o prazo antigo; PI5558Y (Karaokê) ativo com validade 27/07/2028 e
  **sem** trava.
- Os 674 SKUs do banco estão todos na planilha, e os 167 "Puket Escolares" estão **todos na aba
  Puket**: a marca se corrige sozinha no primeiro sync bom, sem produto fantasma.

Limite: o dry-run prova a leitura e o que seria gravado; não prova a gravação em si nem a leitura do
Linx em produção, que só acontecem depois do deploy.

## 5. Pendências do time fiscal (5 SKUs)

| SKU       | Situação                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| PI4368Y   | dois certificados encerrados: 6544/2021-BRI e 6788/2021-BRI                                                   |
| PI6014Y   | dois certificados encerrados, fornecedores diferentes: 9142/2023-BRI-1 (Hesen) e 10550/2024-BRI-1 (Ruifutong) |
| 100400422 | dois certificados encerrados: 8338/2022-BRI-1 e 9410/2023-BRI-1                                               |
| 100400423 | idem                                                                                                          |
| 050403623 | aba Puket com 10584/2024-AE-2 e SITUAÇÃO vazia; Encerramentos com 9459/2023-AE-3 (prazo 21/08/2026)           |

Pergunta objetiva para Eduarda/Letícia: qual certificado vale para cada um, e o 050403623 deveria
estar "Ativo" na coluna SITUAÇÃO? Se sim, basta preencher a coluna: o bloqueio sai no sync seguinte.

## 6. Licenciamento: medição que muda a regra de exibição

Leitura do Linx para os SKUs do painel (18/09): na Puket a grife é "PUKET" (marca da casa) em 381 de
397, com licenciador de fato (MINIONS, SNOOPY, LILO & STITCH, HARRY POTTER) no restante; na
Imaginarium `IMG_LICENCIAMENTO` está vazia em 276 de 277. Cerca de 95% dos produtos certificados
**não são licenciados**. A derivação marcava todo ATIVO sem data de licenciamento como "pendente /
venda bloqueada", porque lê `licenciamento_aplicavel`, coluna que não existe no banco. Contraria a
regra do time (data vazia ou 01/01/1900 nunca entra na conta) e é o falso bloqueio relatado.
Correção delegada — ver seção 7.

## 7. Segunda onda (implementadores em worktrees isoladas, arquivos disjuntos)

Seis revisores somente leitura (regras, planilha, Linx, cadastro, relatório/UI, marketplace), usando
as skills `revisao-de-codigo`, `seguranca-owasp` e `design-de-interfaces` do MCP Cultura Builder,
produziram os achados; quatro implementadores corrigiram, cada um com teste que falha antes da
correção. As quatro branches entraram sem conflito de código.

| Frente      | Merge     | O que entrou                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regras      | `4844aa5` | Aplicabilidade do licenciamento derivada de `grife` + `linx_synced_at` (a coluna `licenciamento_aplicavel` nunca existiu); licenciamento pendente não bloqueia venda; falso "Liberada" de encerrado sem prazo de certificação; `site_status` enxerga licença vencida; "Ativo." com pontuação                                           |
| Relatório   | `8de319a` | "Ver" relatório de validação abria **sempre vazio** (backend grava `products`, página lia `results`); exportação vazia avisa; rótulo de PENDENTE no Excel; "Puket Escolares (legado)"                                                                                                                                                  |
| Marketplace | `ef40946` | Veredito pela evidência no site (Conforme / Não conforme / Revisar), **sem** regra automática de 500 peças; leitura de qualquer especificação Inmetro e da descrição; `category` validada e sem redirect; item ruim não derruba o lote; retry limitado; execução única; CNPJ/telefone/CEP/data não contam como registro                |
| Cadastro    | `34412bf` | Formulário envia a **situação** (antes, qualquer fim de venda devolvia 400); **carga em lote `SKU;data`** com prévia obrigatória e erro por linha (pedido da Lilian); data colada não vira mais SKU; sem certificado órfão; número repetido = 409; status `skipped` quando nada é gravado no Linx; `docs/CERT-LINX-WRITE.md` corrigido |
| Gateway     | `0e3434b` | `POST .../items/batch` em `cert.operate` (segmento literal; `%`, subpath e outros métodos seguem em admin)                                                                                                                                                                                                                             |
| Teste       | `19c7b90` | Asserção de Configurações que estava vermelha em `master` desde `6cbb9c2` (só o teste)                                                                                                                                                                                                                                                 |

Nenhuma coluna de relatório foi criada, removida, renomeada ou reordenada. Dois valores derivados
mudam: licenciamento sem data deixa de marcar venda bloqueada, e licença vencida com produto no site
passa a "Não conforme".

## 8. Antes e depois, com as fontes reais (simulação sem escrita, 18/09)

Banco de produção + o que a planilha gravaria + leitura ao vivo do Linx, passados pela derivação
atual e pela nova:

| (certificação, venda, licenciamento)            | Hoje | Depois |
| ----------------------------------------------- | ---- | ------ |
| Ativo, **bloqueada**, pendente                  | 286  | 0      |
| Ativo, liberada, não aplicável / válido         | 0    | 281    |
| Ativo, liberada, pendente (licenciado sem data) | 0    | 1      |
| Ativo, bloqueada, **licença vencida**           | 0    | 8      |
| Encerrado, bloqueada                            | 286  | 275    |
| Encerrado, liberada                             | 102  | 109    |

- O Linx tem data de licenciamento real em 60 dos 674 SKUs e a propriedade de certificação
  preenchida em 429.
- O filtro da Lilian (Encerrado + Vencido) passa a devolver **22 produtos**.
- 8 ativos continuam bloqueados e é bloqueio legítimo: Puket LILO & STITCH com licença vencida em
  30/05/2026 (050404329, 050404024, 050404026, 050404027, 050404272, 050404273, 050404274,
  050404403).
- 11 SKUs mudam de certificação/venda por motivo que não é o licenciamento: sete Imaginarium com
  "Venda até fim do lote" deixam de aparecer bloqueados (PI4259Y, PI4255Y, PI4193Y, LY2877, PI4219Y,
  PI4220Y, PI4229Y) e quatro Puket ex-Escolares passam a Ativo/liberada (050404881, 050404836,
  050403666, 050403611 — os dois últimos estavam travados pelo prazo 21/08/2026 de um certificado
  antigo: o "produto bloqueado que não era para estar").

Limite: é simulação. A gravação e a leitura do Linx pelo job só se confirmam depois do deploy.

## 9. Gates no estado integrado (rodados pelo orquestrador, HEAD `0e3434b`)

| Gate                                 | Resultado                                 |
| ------------------------------------ | ----------------------------------------- |
| cert-api `pytest`                    | 1.133 passaram (base 888)                 |
| cert-api `ruff check app tests`      | limpo                                     |
| `npm run lint` / `npm run typecheck` | limpos (API e web)                        |
| web `npm test`                       | 61 arquivos, 425 passaram                 |
| `npm run build`                      | ok                                        |
| api `npm test`                       | 2.086 passaram, 5 ignorados, **1 falhou** |

A falha da API é `process-with-ai-resilience.test.ts > ... exceeds the operational timeout`
(timeout de 5 s com fake timers). **É preexistente**: falha igual numa worktree limpa de `master`,
com Node v24.21 local. Área de extração de documentos da importação, fora do escopo desta rodada —
não foi alterada. Não sei como se comporta no CI.

`ruff format --check` acusa dois arquivos do cert-api; já acusava em `master`. O gate do projeto é
`ruff check`.

## 10. Não feito, por decisão

- Coluna nova no Excel com o vencimento do licenciamento lido ao vivo (a geração já lê e descarta):
  restrição de não alterar colunas.
- Exportação respeitando os filtros da tela; contadores nos chips; edição do certificado pela tela.
- `/api/expired` e `total_expired` ainda usam `is_expired`, recalculada só no sync.
- Dry-run da **carga** do Linx segue tudo-ou-nada; carga do zero das propriedades segue dependendo de
  conciliação e aprovação (Eli/Tiago). `LINX_WRITE_ENABLED` não foi tocada.
- SKU não encontrado no Linx cai em "Não aplicável" (hoje os 674 são encontrados). Sem checagem de
  frescor de `linx_synced_at`.
- Marketplace: execuções antigas seguem "Revisar" até rodar auditoria nova; sem tabela de execuções.
- Cronograma no Sheets e coluna N (dupla certificação): fora do código.

## 11. Retomada e revisão independente — 18/09/2026

Base `0e3434b`, branch mantida; alterações locais, sem commit, push, deploy ou escrita em produção.
O ajuste A1 em `erp_service.py` e seu teste já estavam no diretório ao retomar e foram preservados.
Três agentes independentes revisaram regras, contratos/UI/segurança e validações API/web.

Correções e verificações desta retomada:

- Encerramento do mesmo certificado ativo é preservado, protegido da limpeza e listado como
  pendência; encerramento de outro certificado continua histórico. Cobertura adicional verifica
  ambas as ordens das linhas, número vazio e resolução seguida da derivação de venda/site.
- **MEDIO, corrigido:** bloqueio textual explícito em Encerramentos deixava produto no site como
  Conforme. Agora resulta em Não conforme; `URL_NOT_FOUND` continua Conforme. Teste de regressão
  falhou antes e passou depois. Situação e dados originais preservados.
- **BAIXO, corrigido:** resultado de lote mostrava zero erros mesmo com linha `falhou`. A UI conta
  linhas efetivamente gravadas, sem alteração, ignoradas e com falha; prévia e `valid` preservados.
- Falha preexistente de timeout da API resolvida no teste: mock de `extractPopplerText` evita
  subprocesso real antes de instalar o timeout sob fake timers. Sem aumentar timeout, relaxar
  asserções ou modificar o processamento real; wrapper Poppler continua coberto por testes próprios.

**ALTO, pendente de decisão de escopo:** mesmo certificado encerrado com data vencida e STATUS
vazio/permissivo ainda pode resultar em venda liberada se a situação declarada for Ativo.
O snapshot guarda apenas o número do certificado atual, sem o número do encerramento; derivação
isolada não distingue esse caso de prazo residual do certificado antigo. Não foi alterada a fonte
`situacao` nem criado campo de banco. Foi proposta ao usuário proveniência interna do encerramento,
sem alterar colunas de planilha/relatório, para permitir resolver a contradição com segurança.
A medição anterior dizia zero casos reais; ela não foi repetida nesta retomada e não elimina o risco.

### Evidências atuais

| Comando                                                                                                                                                                                     | Resultado                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cd apps/cert-api && .venv/bin/python -m pytest -q`                                                                                                                                         | 1.139 passaram                                                                                               |
| `cd apps/cert-api && .venv/bin/ruff check app tests`                                                                                                                                        | Passou                                                                                                       |
| `npm run typecheck`                                                                                                                                                                         | Passou API/web, após alterações finais da UI                                                                 |
| `npm test`                                                                                                                                                                                  | API 2.087 passaram / 5 ignorados; web 426 passaram                                                           |
| `npm run lint`                                                                                                                                                                              | Passou                                                                                                       |
| `npm run build`                                                                                                                                                                             | Passou API/web                                                                                               |
| `npm run test:e2e:web -- route-smoke.spec.ts --grep certificacoes`                                                                                                                          | 18 passaram; 2 falharam por timeout de rede/DNS no mobile                                                    |
| `npm run test:e2e:web -- route-smoke.spec.ts --project=chromium-mobile --grep 'certificacoes/(configuracoes\|rota-inexistente)' --output output/playwright/review-contracts-e2e --trace on` | Os 2 cenários passaram na reexecução, sem editar código                                                      |
| `npm run format:check`                                                                                                                                                                      | Falhou somente nos arquivos preexistentes não rastreados `_offenders.spec.ts` e `_shot.spec.ts`, preservados |
| Ruff format nos arquivos Python alterados                                                                                                                                                   | Divergências de formatação também presentes em HEAD; sem reformatação ampla                                  |
| `git diff --check`                                                                                                                                                                          | Passou                                                                                                       |

Logs locais: `/tmp/importacao-retomada-cert-final.log`, `/tmp/importacao-review-test-final.log`,
`/tmp/importacao-review-typecheck-final.log`, `/tmp/importacao-review-lint.log`,
`/tmp/importacao-review-build.log`, `/tmp/importacao-retomada-format.log` e
`/tmp/importacao-retomada-e2e.log`. Não são artefatos versionados.
Fontes externas Google Fonts são acessadas no smoke; o host exato da falha inicial não foi
comprovado porque os traces iniciais já não estavam disponíveis na investigação.

MCPs efetivamente consultados: ai-memory e dotcontext. Cultura Builder 1.0.0 conectado via
protocolo MCP com autenticação existente, sem persistir credenciais: `initialize`, `tools/list`
e `get_skill` para `revisao-de-codigo` e `seguranca-owasp`. Skills aplicadas à revisão por camadas,
autorização server-side do batch, SQL parametrizado, limites de URL/redirect do marketplace e
preservação de contratos. Nenhum código/dado privado enviado ao Cultura Builder.
Hook Husky `pre-commit` configura `lint-staged`; não foi disparado, pois não houve commit.

Aceite global permanece **parcial**: decisão sobre proveniência interna pendente; gravação/sync real
e Linx não revalidados em produção. Os números das seções 4 e 8 são evidências históricas da sessão
anterior, não nova simulação executada nesta retomada.

## 12. Proveniência interna autorizada e validada localmente — 18/09/2026

Usuário respondeu: "Sim, adicionar campo interno e validar localmente". Esta seção substitui a
pendência de decisão da seção 11. Escopo: corrigir o encerramento do mesmo certificado com prazo
vencido e STATUS vazio/permissivo, preservando dados originais, fontes e contratos públicos.

Implementação:

- Nova migration `apps/cert-api/sql/20260918_encerramento_provenance.sql`: coluna interna TEXT
  nullable, sem default, sem UPDATE de dados existentes. Não altera migration já aplicada.
- Runner `app.db.release_migrations` lê ambos os artefatos antes de iniciar DDL; `--apply` aplica
  as migrations e verifica o schema. Startup e `--check` só verificam; coluna ausente impede
  iniciar o runtime novo. `scripts/deploy.sh` já chama esse runner antes do restart.
- Sync grava o número original da aba Encerramentos no campo novo, sem substituir o número ou
  a situação da aba da marca. Limpeza remove prazo/status/proveniência juntos, inclusive resíduos
  que tenham apenas a proveniência. Todas as mutações do sync usam a mesma transação.
- Derivação compara números não vazios, ignorando caixa e espaços. Mesmo certificado ativo e
  encerrado: situação pública permanece Ativo, mas prazo rege venda/conformidade/comercialização.
  Prazo vencido bloqueia; hoje/futuro respeita a janela inclusiva; menor licença continua prevalecendo.
  Sem prazo e sem permissão explícita gera bloqueio/pendência. Certificado diferente ou identidade
  ausente mantém compatibilidade com D11. Fora do site continua Conforme.
- Serialização remove o campo após a derivação. HTTP e XLSX reais com fixtures confirmam ausência
  da chave interna, número/situação originais e as mesmas **29 colunas, na mesma ordem**.

Verificações específicas:

- 16 cenários novos de derivação: sete falharam antes, todos passaram depois; suíte da derivação
  com 431 testes aprovada.
- `cd apps/cert-api && .venv/bin/pytest tests/test_routes.py tests/test_reports.py -q`: 51 passaram.
- `cd apps/cert-api && CERT_RUN_POSTGRES_TESTS=1 .venv/bin/pytest -q tests/test_encerramento_provenance_postgres.py`:
  um cenário integrado passou em PostgreSQL 16 real, com migration 2x, snapshot legado intacto,
  coluna TEXT/NULL/sem default, Sheets simuladas, sync com escrita real local, prazo vencido
  vazio/permissivo, certificado antigo sem trava, limpeza, projeção SQL anterior compatível e
  rollback integral após data inválida no SQL. Usa validação `OK` para provar a mudança de conformidade.
- Fixture cria container próprio efêmero, imagem local sem pull, tmpfs, porta aleatória somente
  em 127.0.0.1 e pool exclusivo. Não acessa bancos existentes. Container removido ao concluir.
  Sem opt-in esse teste é ignorado deliberadamente; sua execução efetiva está registrada acima.
- `cd apps/cert-api && .venv/bin/python -m pytest -q`: **1.169 passaram, 1 opt-in ignorado**.
- Gates gerais reexecutados no estado integrado: `npm run typecheck`, `npm run lint`,
  `npm run build` e `npm run format:check` passaram; `npm test` aprovou **2.087 testes API
  (5 opt-in ignorados) e 426 testes web**. A pendência Prettier da seção 11 foi resolvida por
  outra execução nos arquivos exploratórios; essas alterações foram preservadas.
- Ruff check e `git diff --check` aprovados. Arquivos Python novos e runner/teste de release
  formatados; dívida de formatação dos arquivos legados preservada.

Operação e recuperação:

1. Preparação local concluída; não houve push, deploy, migration remota ou alteração de planilhas/Linx.
2. Em eventual publicação autorizada, executar o runner explícito antes do novo runtime; o deploy
   existente já fornece esse gate. A adição de coluna pode exigir lock de catálogo; não foi medida
   concorrência produtiva neste ensaio local.
3. Não preencher retrospectivamente a identidade usando `numero_certificado`: isso confundiria
   certificado antigo com atual. Registros legados ficam NULL até um sync válido ler Encerramentos.
4. Rollback operacional é do código, mantendo a coluna aditiva. Código antigo pode limpar prazos
   sem conhecer a proveniência; ao reimplantar a versão nova, exigir sync bem-sucedido para reconciliar.
   Enquanto ele falhar, proveniência residual pode produzir pendência conservadora.

Revisão independente de migration/persistência e contratos concluída, sem bloqueador novo.
Não se afirma validação produtiva: os números das seções 4/8 continuam históricos.

**Entrega local concluída e validada.** Logs temporários: `/tmp/importacao-provenance-python.log`,
`/tmp/importacao-provenance-postgres-final.log` e `/tmp/importacao-provenance-{typecheck,test,lint,build,format-check}.log`.
Skill de evolução de schema aplicada; orientação de revisão/segurança do Cultura Builder já lida
na seção 11 reutilizada na revisão desta mudança. Checkpoint atualizado na sessão dotcontext existente.
ai-memory foi consultado, mas retornou contagens de projeto divergentes entre consultas próximas;
não foi feita nova gravação durável nesta rodada sem confirmar o escopo. Memórias versionadas
`PROJECT_MEMORY.md` e `SESSION_MEMORY.md` atualizadas como registro local seguro.

## 13. Auditoria dos campos e parâmetros — 18/09/2026

Solicitação: revisar todos os campos da certificação e verificar a atualização. Usuário reforçou
que a propriedade no banco deve receber o **fim de vendas do certificado**. Três frentes revisaram
UI/API/cadastro, Sheets/snapshot/derivação e escrita/leitura Linx. Matriz completa:
[CERT-CAMPOS-E-PARAMETROS](CERT-CAMPOS-E-PARAMETROS.md).

Conclusões comprovadas por código e testes:

- Writer recebe `fim_venda` efetivo; validade e licenciamento são `None` no encaminhamento do
  cadastro e ignorados pelo writer em defesa adicional. Alvos: 00106 Imaginarium/00224 Puket.
- Cadastro cria pai, não edita seus metadados; alterações disponíveis são vínculos/restrições/retry.
  Snapshot Produtos tem outras fontes. Propriedade ERP não contém número/validade/OCP/PDF.
- Ativo/sem data não limpa valor antigo; leitura de PRODUTO_CORES não prova propagação da propriedade.
  Flag produtiva não consultada nesta revisão. Carga conciliada apply continua bloqueada.

Correções focadas:

1. **ALTO:** reader eliminava encerramento com identidade, mas sem prazo/status; correção anterior
   da derivação não recebia o fato. Linha identificada agora segue até persistência e pendência;
   certificado antigo permanece histórico. Regressões falharam antes e passaram depois.
2. **MEDIO:** CLI do dry-run exigia `certificados` em uma forma de ambiguidade que fornece números
   vigente/encerramento separados. Consome ambos sem inventar valores. Help/banner/final agora
   descrevem corretamente apply bloqueado; relatório é evidência, não promessa de rollback.

Validações próprias desta rodada:

- `.venv/bin/pytest tests/test_erp_sheets.py tests/test_derivation.py -q`: 485 passaram.
- `.venv/bin/pytest tests/test_certificates_routes.py tests/test_item_restrictions.py tests/test_linx_service.py -q`:
  204 passaram na revisão cadastro/Linx.
- CLI/serviço Linx/atributos/gates/restrições: 160 passaram; quatro regressões da CLI falhavam antes.
- `CERT_RUN_POSTGRES_TESTS=1 .venv/bin/pytest -q tests/test_encerramento_provenance_postgres.py`:
  **2 passaram**, incluindo reader real → sync → PostgreSQL para encerramento sem prazo/status.
  Containers próprios descartáveis removidos; só fontes sintéticas.
- `.venv/bin/python -m pytest -q`: **1.175 passaram / 2 opt-in ignorados**, estes executados acima.
- `.venv/bin/ruff check app tests scripts`: passou; `git diff --check`: passou.
- Gates gerais reexecutados: `npm run typecheck`, `npm run lint`, `npm run build` e
  `npm run format:check` passaram; `npm test` aprovou **2.087 API / 5 opt-in ignorados e 426 web**.
- Ruff format passou na CLI e nos dois testes novos. Regressões da CLI repetidas após formatação:
  4 passaram. Dívida Ruff format dos arquivos legados já documentada permanece fora da correção.
- Matriz de campos revisada independentemente contra o código, incluindo precisão da validação
  de PDF (extensão e assinatura inicial; não validação estrutural completa).

Achados remanescentes foram registrados em KNOWN_ISSUES e na matriz: campos públicos de SKU
exclusivo Encerramentos só preenchem ausentes; flag `is_expired` pode divergir da venda calculada;
sentinela aceita no pai e bloqueada antes do ERP; ausência de edição do pai. Não foram criadas
features de edição, novas colunas ou novos fluxos de escrita para ocultar essas limitações.

Nenhum push, deploy, alteração de planilhas ou escrita no Linx. O envio real depende da configuração
e autorização operacionais; mocks e PostgreSQL local não comprovam uma gravação SQL Server real.

## 14. Preparação de release e comprovação SQL — 18/09/2026

O usuário solicitou avançar até deploy após validação e reforçou que o SQL deve atualizar a
propriedade com o fim de vendas. Deploy solicitado; publicação Git e ativação/carga Linx devem
respeitar as autorizações específicas. Trabalho de UX e auditoria documental de outras sessões
permanece fora desta release. Candidato preparado em worktree isolado.

### Contrato e leitura produtiva

- Propriedade de certificação = fim de vendas efetivo; validade do certificado e licenciamento
  nunca substituem esse valor. UPDATE usa produto/propriedade/item, sem alterar outras propriedades.
- Produção continua na revisão `6cbb9c260460ca0b8bde9a155c960d3b003cfea4`; containers saudáveis.
- Container e SOPS: `LINX_WRITE_ENABLED=false`, `LINX_SKU_IS_PRODUTO=true`;
  SOPS mantém `SYDLE_SYNC_ENABLED=true` (integração já ativa, independente deste rollout).
- PostgreSQL: 674 produtos; zero validades preenchidas e zero `linx_synced_at`; último sync
  observado em 18/09 às 14:20 UTC concluído com erro. Zero certificados e zero vínculos de
  cadastro no portal. Não há cadastro existente para usar como piloto de retry.
- Alvo real do banco/usuário coincide com os defaults de backup. Compose válido, rede externa
  disponível e espaço livre suficiente na leitura pré-deploy. Backup ainda não executado nesta etapa.
- SQL Server real: SELECT/INSERT/UPDATE permitidos nas duas marcas; colunas reais conferidas.
  Puket: 3.716 linhas da propriedade de certificação, zero produtos duplicados. Imaginarium:
  1.376 linhas, um produto/propriedade duplicado. Todos os itens observados são 1. Não houve
  correção automática dessa duplicidade nem qualquer INSERT/UPDATE no ERP.
- Dry-run atual do código candidato em processo separado no container, com SQL de mutação
  interceptado em memória: 947 operações de origem (566 da marca + 381 encerramentos), cinco
  pendências, zero EANs não resolvidos e zero prazos ilegíveis. A contagem não representa
  947 produtos únicos. Nenhum arquivo de runtime produtivo foi substituído.

### Correções adicionais antes de publicação

- Gravador Linx recusa múltiplas linhas/item inesperado sob lock, atualiza a chave completa e
  abre uma conexão independente após commit para conferir valor. Só retorna sucesso após leitura.
  Falha/timeout de commit ou confirmação exige reconciliação; não há retry nem alegação de rollback.
- Deploy compara a flag Linx efetiva do Compose após SOPS com a expectativa autorizada
  (`EXPECTED_LINX_WRITE_ENABLED=false` por padrão); falha de verificação bloqueia migrations e
  restart. Configuração/credenciais são capturadas somente em memória, sem impressão.
- Documentação e comentário de Compose deixaram de apresentar a habilitação histórica de julho
  como estado atual. Carga global da planilha continua bloqueada até baseline, aceite e recuperação.

### Sequência de ativação e aceite pendente

1. Fechar testes do estado final e commit revisável; publicar apenas após autorização Git.
2. Exigir CI aprovado da revisão exata e master limpa/sincronizada.
3. Executar `scripts/deploy.sh` com backup obrigatório, preservando SYDLE e a flag Linx aprovada;
   não enviar notificação de chat sem autorização. Build precede migrations e restart.
4. Verificar readiness e schema; observar sync de startup até terminar, com Sheets e leitura Linx
   confirmadas separadamente. Não executar novo sync se o startup já produziu evidência válida.
5. Reconciliar contagens, proveniência, renovados e bloqueados via SQL e derivação/API. Readiness
   e colunas legadas `status_venda`/`is_expired` não substituem essa conferência.
6. Para Linx real, definir piloto/lote exato, baseline da chave completa e valor anterior,
   propriedade de licenciamento e plano de recuperação antes de ativar escrita. Confirmar valor
   após gravação e licenciamento intacto; não assumir propagação para `PRODUTO_CORES.FIM_VENDAS`.

Rollback de deploy restaura código, não dados/migrations nem efeitos de triggers do ERP.
A coluna interna aditiva é compatível com código anterior, mas reimplantação requer novo sync válido.

### Evidências finais da preparação

- Python: 1.189 passaram e três testes opt-in foram separados. PostgreSQL real: dois passaram
  na revisão independente; SQL Server 2022 real isolado: um passou em 28,89s. Container SQL
  exclusivo removido e ausência confirmada. A duplicidade produtiva afeta um produto do snapshot;
  não é chave vazia. Correção de dados não foi autorizada nem executada.
- `npm run typecheck`, `npm test` (2.087 API + 426 web, cinco opt-in API ignorados),
  `npm run lint`, `npm run build`, `npm run format:check`: todos aprovados.
- E2E API: primeira execução aprovou 69 cenários; setup de `processes.e2e.test.ts` excedeu 60s
  e impediu cinco. Reexecução dirigida com `CI=true` aprovou os cinco em 10,06s. Nenhum timeout
  foi aumentado e nenhum teste foi enfraquecido. Evidência combinada: 74 cenários aprovados.
- Gates locais: 10 testes deploy, quatro geração de ambiente e sete restauração aprovados.
  Ruff e `git diff --check` aprovados. Regressões específicas do writer: 174 testes aprovados.
- Logs temporários: `/tmp/importacao-release-{typecheck,test,lint,build,format}.log`,
  `/tmp/importacao-release-python-final.log`, `/tmp/importacao-release-ruff-final.log`,
  `/tmp/importacao-release-api-e2e.log` e `...-api-e2e-retry.log`. As evidências anteriores
  permanecem no histórico; a primeira falha de setup E2E não foi apagada.
- Cultura Builder `get_skill(revisao-de-codigo)` consultado nesta rodada; somente instruções
  genéricas recuperadas, sem envio de código/dados. Skill local de contratos de dados aplicada.
  ai-memory voltou a resolver outro projeto em leitura de página; nenhuma gravação realizada
  nesse escopo inconsistente. Contexto canônico permanece no STATUS e na sessão dotcontext.

Ainda não houve publicação Git, CI remoto da revisão nova, migration remota, deploy ou escrita
SQL Server. Os resultados locais não devem ser apresentados como atualização produtiva concluída.

### Escopo SQL confirmado pelo usuário após preparação da release

O usuário confirmou: **somente cadastro/reenvio pelo portal** precisa gravar o fim de vendas
no Linx. A carga da planilha permanece bloqueada para escrita no ERP e está fora deste aceite.
A leitura/sincronização das fontes para o PostgreSQL continua parte da correção de certificação.
O commit candidato `8bb9fda` atende esse limite sem mudança de implementação. A resposta sobre
escopo não respondeu à autorização separada de push/integração, que permanece pendente.

## 15. Release implantada e aceite operacional — 18/09/2026

**Finalizado o deploy autorizado:** revisão `8bb9fdabcc9ec0b706794c5623239948202c21a0`
implantada em 18/09/2026 às **11:49:52 BRT**, após push e integração explicitamente autorizados.
PR [101](https://github.com/nmatss/importacao/pull/101) integrado por fast-forward; master no
checkout `/tmp/importacao-release-20260918` limpo e igual a origin/master. O checkout original
com trabalho concorrente de UX/documentos foi preservado.

### CI e execução

- CI do PR [35356810026](https://github.com/nmatss/importacao/actions/runs/35356810026) e CodeQL
  [35356809877](https://github.com/nmatss/importacao/actions/runs/35356809877): sucesso para `8bb9fda`.
- CI do master [35357738098](https://github.com/nmatss/importacao/actions/runs/35357738098) e
  CodeQL [35357738345](https://github.com/nmatss/importacao/actions/runs/35357738345): sucesso.
  Incluem testes/E2E, typechecks/lint, auditorias, três builds/scans Trivy e SBOMs.
- `scripts/deploy.sh` concluiu exit 0, com backup obrigatório, snapshot, SOPS, gate de flag Linx,
  migrations explícitas, readiness de API/certificação/web/proxy e HTTPS público. Sem notificação
  de chat. SYDLE existente preservado. API APP_VERSION e arquivo remoto REVISION conferem `8bb9fda`.
- Primeiro comando omitiu CURL_CA_BUNDLE e ficou em retry de HTTPS por CA interna não confiada
  localmente; aplicação estava saudável. CA raiz pública foi obtida de `internal-ca` por SSH
  autenticado; `curl --cacert` aprovou TLS/hostname e retornou 200. Somente o monitor próprio foi
  interrompido (exit 143), sem parar containers ou declarar sucesso. O snapshot anterior `6cbb9c2`
  foi preservado em `/home/nicolas/importacao.rollback-pre8bb9fda-20260918`; depois o procedimento
  completo foi reexecutado com `CURL_CA_BUNDLE=/tmp/importacao-release-internal-ca-public.crt`,
  sem remover gates e sem mudar trust stores. Essa segunda execução concluiu exit 0.
- Lição operacional: antes de iniciar deploy com endpoint público, obter a CA interna por canal
  autenticado e testar HTTPS com o MESMO CURL_CA_BUNDLE que o processo de deploy receberá.

### Recuperação

Backups completos mantidos no servidor: `importacao_2026-09-18_143200*` (ensaio),
`importacao_2026-09-18_144102*` (pré-mudança) e `importacao_2026-09-18_144804*` (reexecução).
Dump custom com catálogo legível e arquivos uploads/relatórios/certificados arquivados.
Restauração real do backup 143200 em banco temporário recuperou 48 tabelas, 117 processos, 674 produtos e
zero certificados de cadastro; banco temporário criado pelo ensaio removido com sucesso.
O snapshot reservado acima mantém o código anterior. Rollback de código não desfaz dados nem DDL.

### Atualização real de dados e contrato público

Sync `470c3fbf-0429-4bd2-8fc0-56c2ad0b0ac5`, startup, de 14:44:53 a 14:45:18 UTC, terminou sem erro:

| Verificação                              | Resultado                                 |
| ---------------------------------------- | ----------------------------------------- |
| Linhas de origem processadas             | 947 =566 abas de marca +381 encerramentos |
| Produtos únicos                          | 674, preservando a quantidade anterior    |
| Validade preenchida                      | 541 (antes0)                              |
| Proveniência interna preenchida          | 381                                       |
| Leitura Linx atualizada no PostgreSQL    | 674 (antes0)                              |
| Prazos antigos limpos pelo resolver      | 15                                        |
| Marca legada Puket Escolares no snapshot | 0 (antes167)                              |
| Pendências de vínculo da fonte           | 5, preservadas e sinalizadas              |
| API conferida contra derivação do banco  | 674 produtos, zero divergências           |
| Campo interno no JSON público            | Ausente                                   |
| Schema da proveniência                   | TEXT anulável, sem default                |

Leitura Linx: 397 Puket + 277 Imaginarium, nenhuma marca com erro. O campo de validade do certificado
continua separado do fim de vendas. Status de venda atuais: 391 LIBERADA e 283 BLOQUEADA; isso não é
um objetivo de maximizar liberações. As travas válidas permanecem aplicadas pela regra.
Confirmação repetida após a conclusão do deploy manteve os mesmos resultados, sem novo sync forçado.

HTTPS com CA/hostname verificados: raiz, quatro assets JS/CSS e `/api/health` retornam 200;
`/api/auth/me`, `/api/processes` e `/cert-api/api/products` sem autenticação retornam 401.
HSTS único `max-age=300` e CSP presentes. API, web e cert-api saudáveis.

### Limites expressamente preservados

Usuário definiu escrita SQL **somente cadastro/reenvio pelo portal** e aprovou esta publicação
**mantendo LINX_WRITE_ENABLED=false**. Flag false foi conferida em SOPS/Compose, gate de deploy e
runtime final. Nenhum INSERT/UPDATE foi feito no SQL Server do ERP; não houve homologação de
escrita produtiva nem limpeza de propriedades. O writer foi validado em SQL Server 2022 real
isolado, incluindo fim de vendas, licença intacta, PK, duplicidade e confirmação pós-commit.
A carga da planilha continua bloqueada para escrita ERP. Uma duplicidade produtiva de propriedade
(Imaginarium, um produto do snapshot) e as cinco pendências da fonte não foram corrigidas por
inferência. Permanecem as limitações funcionais anteriores documentadas na matriz de campos.

Logs locais: `/tmp/importacao-release-deploy.log`, `...-deploy-retry.log`, `...-restore-real.log`,
`...-postdeploy-data.log` e `...-postdeploy-final.log`. Estes arquivos são temporários; os
resultados sanitizados ficam neste documento e na sessão dotcontext 5db6ff64-7243-44cd-b5f2-3071d25ed3d9.

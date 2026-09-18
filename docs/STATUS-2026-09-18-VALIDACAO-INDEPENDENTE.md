# Retomada — validação independente de 18/09/2026

## Escopo e origem

Continuação solicitada a partir do dashboard executivo e das verificações interrompidas.
Base observada: `0e3434b`, branch `fix/cert-sync-quarentena-2026-09-18`, com alterações locais
preexistentes. Outra execução alterou código/testes e documentação durante a leitura; este
relatório separa as evidências desta sessão das da seção 11 do STATUS de certificação.

Nenhuma coluna, regra de negócio, migration ou configuração de produção foi alterada nesta
sessão. Alteração própria de código limitada à formatação Prettier dos scripts exploratórios
preexistentes `apps/web/e2e/_offenders.spec.ts` e `apps/web/e2e/_shot.spec.ts`.
Não houve commit, push, deploy, carga Linx ou escrita nas planilhas.

## Cultura Builder

MCP `cultura-builder` 1.0.0 acessado pelo endpoint já configurado no ambiente, com a
autenticação existente utilizada somente em memória. Operações: `initialize`, `tools/list`,
`list_skills` e `get_skill` para `revisao-de-codigo`, `seguranca-owasp` e
`design-de-interfaces`. Nenhum código ou dado do projeto foi enviado ao serviço.

Aplicação: revisão dos diffs e casos de borda, autorização do endpoint de lote, limites de
entrada, SQL parametrizado, resultado parcial e conferência visual do dashboard. A consulta
ai-memory retornou referências misturadas de projetos; não foi usada como prova do estado atual.

## Evidências executadas

Ambiente: Node v24.21.0 e Python 3.12.3. CI usa Node 22; execução local não substitui CI.
Logs desta sessão: `/tmp/importacao-validation-20260918/` (temporários, não versionados).

| Comando                                                                    | Resultado                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                        | Passou API e web                                                                            |
| `npm test`                                                                 | API: 2.087 passaram, 5 ignorados; web: 426 passaram                                         |
| `cd apps/cert-api && .venv/bin/python -m pytest -q`                        | 1.169 passaram / 1 ignorado na última execução; integração opcional executada separadamente |
| `npm run lint`                                                             | Passou                                                                                      |
| `npm run build`                                                            | Passou API e web                                                                            |
| `npm run test:e2e -w apps/api`                                             | 74 passaram, PostgreSQL isolado via Testcontainers                                          |
| `apps/cert-api/.venv/bin/ruff check apps/cert-api/app apps/cert-api/tests` | Passou                                                                                      |
| `npm run format:check`                                                     | Passou após formatar os dois scripts exploratórios                                          |
| `npm audit --omit=dev --audit-level=moderate`                              | Zero vulnerabilidades nas dependências de produção Node                                     |
| `git diff --check`                                                         | Passou                                                                                      |

`ruff format --check` nos quatro arquivos Python modificados falhou. A mesma verificação,
alimentada por `git show HEAD:<arquivo>`, também falhou para cada um dos quatro. Dívida de
formatação preexistente; não foi feita reformatação ampla. Ruff lint passou.

## Navegador

Smoke de rotas desktop/mobile: **78 passaram** (`npm run test:e2e:web -- apps/web/e2e/route-smoke.spec.ts`).
A matriz usa fixtures locais, nove telas,
375/768/1440 px e temas claro/escuro. Inclui executivo e os oito consumidores de DateRangeFilter.
Artefatos: `output/playwright/retomada-20260918/`.

Primeira matriz: quatro cenários passaram, cinco falharam após o encerramento do servidor local
compartilhado com o smoke (erro `ERR_CONNECTION_REFUSED` em 127.0.0.1:4174). Erro de orquestração
desta sessão; não é evidência de regressão da aplicação. Reexecução sequencial dos cinco cenários
em `output/playwright/retomada-20260918-retry/`, preservando os artefatos originais: **5 passaram**.
Resultado combinado: **54 combinações aprovadas** (9 telas × 3 larguras × 2 temas).

Dashboard executivo: seis combinações já aprovadas, sem overflow global ou elementos fora da
viewport. Capturas desktop claro e mobile escuro inspecionadas. Isso não comprova exatidão dos
indicadores de produção nem auditoria integral de acessibilidade/contraste.

## Riscos e limite do aceite

- **ALTO, reproduzido:** `compute_status_dimensions` com `situacao=Ativo`, prazo 24/07/2026,
  referência 18/09/2026 e validação `OK` devolve venda `LIBERADA` e site `CONFORME` quando
  `encerramento_status` é vazio ou `Venda permitida`. Com bloqueio textual explícito, devolve
  `BLOQUEADA`/`NAO_CONFORME`. O snapshot não informa a identidade do certificado encerrado;
  não permite distinguir com segurança encerramento atual de resíduo antigo. Reprodução local
  sintética, sem consulta produtiva. Esse foi o diagnóstico anterior à nova implementação concorrente, descrita abaixo;
  snapshots antigos sem proveniência continuam sem comprovação de recuperação.
- **BAIXO:** log final de `batch_certificate_items` ainda usa contagens de ações planejadas
  para a frase "vinculado(s)" mesmo em resultado parcial. A UI local conta estados efetivos.
  Evidência estática, sem alteração adicional de backend nesta revisão.
- Dívida conhecida de JWT em localStorage: ADR 0003; esta rodada não substitui revisão completa
  de autenticação, infraestrutura ou segurança de produção.
- Testes locais não comprovam sync gravado em produção, leitura atual de Linx/Sheets nem
  resolução das divergências fiscais. As evidências produtivas anteriores são históricas.

Aceite global permanece parcial. Esta validação não autoriza publicação ou alteração de fontes.

## Atualização final — implementação concorrente e nova verificação

Durante a validação de navegador, outra execução acrescentou a migration
`20260918_encerramento_provenance.sql`, a persistência/limpeza de
`encerramento_numero_certificado`, sua utilização no eixo comercial e sua remoção do JSON público.
Esta sessão não escreveu essa implementação nem aplicou a migration em produção.

A repetição de pytest encontrou inicialmente dois testes novos de relatório falhando: consultavam
"Situacao da Venda" em vez de "Status de Venda". A execução concorrente corrigiu a asserção;
na nova execução, **1.169 passaram e 1 foi ignorado**. Log: `cert-latest.log`.

O teste opcional foi então executado por esta sessão:

```bash
cd apps/cert-api
CERT_RUN_POSTGRES_TESTS=1 .venv/bin/python -m pytest -q tests/test_encerramento_provenance_postgres.py
```

**1 passou** em PostgreSQL descartável próprio, removido pelo teardown. Cobre aplicação repetida
da migration, snapshot legado preservado, sync sintético, derivação do certificado atual/anterior
e limpeza. Log: `cert-postgres.log`. Não usa banco nem planilha de produção.

A correção local tem evidência automatizada, mas exige publicação controlada da migration e sync
bem-sucedido para preencher a proveniência nos registros reais. Não há aceite global de produção.

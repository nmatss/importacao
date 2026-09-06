# Responsividade e temas — retomada de 2026-09-06

Estado: correcoes de layout concluidas e validadas no escopo abaixo.
A experiencia integral de Cambios tem uma pendencia funcional preexistente; nao
ha declaracao de perfeicao universal. Deploy solicitado posteriormente pelo usuario;
o resultado operacional e registrado na sessao canonica do dotcontext.

## Escopo e estado inicial

Continuacao da auditoria de layout, UX e UI em Importacao e Certificacoes.
As correcoes nao incluem novas funcionalidades, mudancas nas APIs, banco ou integracoes.
Apos a auditoria, o usuario solicitou deploy, revisao posterior e lista de pendencias.
Branch inicial: `master`, revisao `9cf9453`. Foram preservados 23 arquivos rastreados
ja modificados, fixtures, runner e `useMediaQuery` deixados pela sessao anterior.

A execucao anterior terminou em timeout de 1.200 segundos sem relatorio consolidado.
Capturas e relatos antigos nao foram tratados como aprovacao do estado atual.

## Correcoes

- Mantidas as correcoes anteriores de cabecalho do processo, documentos, checklist,
  proformas, banners, estados de carregamento e legendas dos graficos no mobile.
- Valores dos KPIs separados dos icones para aproveitar a largura inteira do cartao,
  incluindo Meu Dia (overflow de 24 px confirmado em 1024 px) e Compras/Pagamentos.
- Graficos em colunas equilibradas, com legendas internas e texto neutro legivel nos
  dois temas; alertas do Dashboard com rolagem acessivel no desktop.
- Variantes escuras adicionadas a superficies coloridas, avisos, status e acoes.
  As novas variantes respeitam os tokens semanticos existentes, sem novas paletas.
- Textos auxiliares e placeholders com maior contraste; navegacao lateral mais legivel.
- Controles nativos de data/select usam esquema dark; placeholders claros com
  maior contraste e formulario do assistente em uma coluna nas telas pequenas.
- Comparativo Draft BL × BL Final com rolagem horizontal e colunas legiveis;
  antes o overflow hidden tornava a ultima coluna inacessivel.
- E-mails, destinatarios, anexos e historico ganham quebra de texto e empilhamento no mobile.
- Filtros de alertas e marcas quebram linha; o seletor de usuario da auditoria respeita
  a largura disponivel. Corrigidos overflows observados de 54, 46 e 497 px.
- Certificacoes: KPIs sem truncamento dos rotulos, banners legiveis no tema escuro,
  acoes de relatorios empilhadas no mobile, SKU com largura minima e formularios
  ajustados para telas pequenas.
- Area de upload empilha icone, instrucoes e tipo no mobile, evitando texto
  comprimido em uma palavra por linha.
- Shell usa altura dinamica da viewport quando suportada; espaco final para o assistente
  tambem no desktop; acionador permanece alinhado a direita quando o painel abre.

## Metodo e cobertura

O runner `apps/web/e2e/responsive-audit.spec.ts` usa fixtures sinteticas preenchidas,
nomes extensos, valores grandes e variados estados operacionais. As requisicoes de API
sao interceptadas no navegador: nao executa alteracoes em sistemas reais.

Cada cenario agora tem limite proprio, registra JSON incremental e falha por erros de
browser, abertura de modal/aba, captura ou endpoint sem fixture. Com `AUDIT_ASSERT=1`,
reprova overflow do documento/main e elementos fora da viewport sem scroll intencional.
Os containers estruturais do shell nao sao usados para ignorar elementos cortados.
O carregamento de Suspense e os skeletons precisam terminar: uma captura antiga
continha somente o fallback e foi invalidada. O JSON registra o texto carregado.
A captura expandida aguarda a animacao de Recharts reiniciada pelo redimensionamento.

Capturas `__viewport.png` preservam o layout real. As demais expandem temporariamente
somente o shell durante a captura, para permitir revisar o conteudo rolavel inteiro.
Essas capturas expandidas nao comprovam posicionamento fixo/sticky.

Matriz principal: 59 cenarios, temas claro/escuro e larguras
320, 375, 768, 1024 e 1440 px; menus moveis omitidos no desktop.
O smoke existente complementa a cobertura com rotas, redirecionamentos e estados vazios.
Teclado e contratos de foco sao cobertos pelas suites existentes de layout/modais.

Comando da matriz:

```sh
AUDIT_ASSERT=1 AUDIT_OUT=output/playwright/responsive-verified ./node_modules/.bin/playwright test apps/web/e2e/responsive-audit.spec.ts --project=chromium-desktop --workers=2 --fully-parallel
```

Os lotes usam `AUDIT_ONLY` para selecionar cenarios; cada JSON conserva as dez
combinacoes (seis para menus moveis). A galeria consolidada e
`output/playwright/responsive-verified/index.html`, com os dados em `report.json`.

## Evidencias e gates

- Typecheck: `npm run typecheck` — passou.
- Frontend: `npm test -w apps/web -- --maxWorkers=2` — 237 testes em 53 arquivos passaram.
- Lint final: `npm run lint` — passou.
- Formatacao: `npx prettier --check apps/web/src apps/web/e2e/fixtures apps/web/e2e/responsive-audit.spec.ts` — passou.
- `git diff --check` — passou.
- API: `npm test -w apps/api -- --maxWorkers=2` — 1608 passaram, 1 ignorado.
  Codigo da API permaneceu inalterado.
- Build final: `npm run build` — passou com exit 0.
- Matriz: **59/59 cenarios, 582/582 combinacoes**, zero falhas automaticas de
  carregamento/overflow/fixtures. Revisao visual realizada pelo agente principal.
- Paisagem: **20 combinacoes** a 640×360 e 844×390 passaram.
- Breakpoint desktop Certificacoes: **6 combinacoes** a 1535, 1536 e 1920 px passaram.
- Smoke e e-mails: `./node_modules/.bin/playwright test apps/web/e2e/route-smoke.spec.ts apps/web/e2e/email-workflows.spec.ts --workers=2`
  — **82 testes passaram**, nos projetos Chromium desktop e mobile.
- Controles: campos nativos dark, formulario do assistente, Escape/restauracao de
  foco e acesso por teclado ao menu em paisagem passaram; `interactive/controls.json`.
- Resize dinamico: 30 combinacoes em Dashboard, Meu Dia e Compras/Pagamentos,
  entre 320 e 1920 px, passaram sem overflow nem quebra dos valores monetarios.
  Evidencia: `output/playwright/interactive/resize.json`.

As suites foram limitadas a dois workers durante a retomada devido a carga concorrente
observada no ambiente. Uma execucao inicial de testes teve timeout e foi interrompida;
nao foi usada como evidencia de sucesso. Duas capturas exploratorias foram invalidadas
por HMR durante edicoes. Execucoes longas terminaram por SIGTERM (143). A retomada usa lotes menores
com o filtro AUDIT_ONLY e preserva evidencias por cenario. O comparativo teve
um erro de transferencia de arquivos do Playwright; foi reexecutado e passou nas
dez combinacoes. As falhas de fixtures e preparacao de cenarios foram corrigidas
sem alterar contratos do produto.

## Contexto, memoria e limites

Plano e checkpoints canonicos: dotcontext, sessao
`6400d175-8657-49db-a7ee-2d953cd9c28f` (`responsividade-ui-2026-09-06-retomada`).
O MCP confirmou este repositorio; o workflow anterior referia-se a operacao de agosto.
A consulta padrao ao ai-memory devolveu conteudo de outros projetos e foi descartada.
A busca global identificou o escopo correto `unico/04-importacao`; chamadas explicitas
recuperaram o handoff `01a0779a-016f-71d3-97bb-6f7d50b9429c` da sessao Claude
`90cc8f6a-e20f-40ee-ac6d-537ecea13750`, confirmado por observacoes da auditoria anterior. Nao houve instalacao de servicos.
O hook `.husky/pre-commit` executa lint-staged e deve ser preservado no release.
O resultado real do commit e registrado no checkpoint de publicacao.
Os aprendizados confirmados sobre fixtures, Suspense, screenshots e colunas cortadas
foram gravados com sucesso no ai-memory em `gotchas/responsive-audit-evidence.md`.

A cobertura e delimitada pelas rotas, dados sinteticos, estados e viewports executados.
Nao equivale a garantia de perfeicao em toda combinacao de dados/tamanho/navegador,
nem a homologacao de producao. Safari/iOS fisico e dados reais nao foram validados.

## Pendencia funcional observada, fora do escopo

A tela Cambios exibe `NaN` nos totais com multiplos decimais textuais vindos da API.
A causa e a concatenacao no calculo preexistente de `CurrencyExchangePage.tsx:142`,
confirmada no contrato da API e nas capturas com fixtures. O layout da tela pode
passar nos gates geometricos mesmo com esse erro de calculo. A pendencia esta em
`docs/KNOWN_ISSUES.md`; nao foi corrigida nem mascarada porque calculos estao fora
do escopo autorizado. A experiencia completa dessa tela nao esta aprovada.

## Preflight de publicacao

- Producao acessivel via SSH em `192.168.168.124`, revisao inicial `7340dbb`;
  API, web, PostgreSQL, Redis e cert-api saudaveis; Compose valido, rede existente
  e 563 GiB livres observados. `origin/master` coincide com a base local `9cf9453`.
- Copia de release isolada preserva o worktree original, inclusive arquivos
  exploratorios e capturas preexistentes que nao pertencem ao release.
- SOPS e chave age disponiveis no ambiente de login SSH; o arquivo criptografado
  local coincide com o remoto. SYDLE ja esta ativo e sera preservado.
- HTTPS usa CA interna. `curl` padrao recusou a cadeia nos dois ambientes; com o
  certificado raiz publico obtido do container `internal-ca` por SSH autenticado,
  portal e API responderam HTTP 200, sem desativar verificacao TLS.
- Backup, snapshot, migrations idempotentes e health checks seguem o runner
  `scripts/deploy.sh`. Este documento nao afirma que essas etapas ja ocorreram;
  a evidencia da execucao fica no dotcontext e no log do release.

## Pendencias e responsabilidade

- Sistema, confirmada nesta sessao: corrigir a soma decimal de Cambios, com testes.
- Homologacao: Safari/iOS real, variacoes de dados e fluxos autenticados reais nao
  foram validados pela matriz sintetica. Nao usar os screenshots como homologacao
  da qualidade dos dados ou das integracoes.
- Operacao/TI, registros anteriores a reconfirmar: fontes documentais e aceite humano,
  contas tecnicas Linx, compartilhamento Drive, entrega de alertas e secrets/runner
  do deploy no GitHub. Fontes: `KNOWN_ISSUES.md` e `ROADMAP.md`; os estados historicos
  nao foram revalidados integralmente nesta auditoria de interface.
- Backlog tecnico anterior: filas sem dead-letter observavel, lease/replay,
  linhagem de itens e cache de Certificacoes; detalhes em `TECH_DEBT.md`.

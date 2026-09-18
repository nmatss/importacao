# Revisão de layout, UX e UI — 18/09/2026

## Objetivo e critério de aceite

Nova revisão dos módulos Importação e Certificações, solicitada pelo usuário, usando o MCP
Cultura Builder. Escopo: navegação, hierarquia visual, responsividade, acessibilidade, estados
de carregamento/erro/vazio, formulários e transições entre telas. Preservar colunas e contratos.

Sessão de **auditoria**, não de redesign. Nenhum componente, regra de negócio, banco, migration
ou dependência do repositório foi alterado por esta revisão. O checkout já tinha alterações da
frente de certificação; base Git `0e3434b`. Não houve publicação nem escrita nos sistemas reais.

**Conclusão:** a estrutura responsiva está consistente nos cenários exercitados, mas o aceite de
UX/UI é **parcial**. Há falha de informação financeira em indisponibilidade, barreiras de
contraste/teclado e perda silenciosa de rascunho. Testes de overflow aprovados não eliminam esses
problemas. Não há evidência de incidente produtivo; os defeitos abaixo foram reproduzidos localmente.

## Método e fontes

- Cultura Builder 1.0.0: chamada MCP `list_skills(category="design")` confirmou
  `design-de-interfaces`. Aplicados o conteúdo dessa skill e `revisao-de-codigo`, lidos nesta
  conversa: hierarquia, tipografia, espaçamento, contraste, estados, teclado e mobile-first.
  Conexão existente; credencial usada apenas em memória. Nenhum código, captura ou dado enviado.
- Fontes: `AGENTS.md`, memórias/pendências, ADR 0005, rotas, layouts, componentes compartilhados,
  páginas, clientes de API, testes web e validação de filtros da API.
- Chromium real via Playwright, fixtures do próprio projeto e requisições interceptadas.
  Falhas 503 injetadas somente no navegador; e-mails e ações de negócio não saíram do sandbox.
- Axe-core 4.10.3 instalado em diretório temporário, sem mudar package.json/lockfile.
  Verificados os conjuntos WCAG 2 A/AA, 2.1 AA, 2.2 AA e boas práticas disponíveis no motor.
- Inspeção visual de capturas, reprodução dirigida de teclado, navegação com formulário alterado,
  intervalo invertido, acesso de perfis não administradores e recuperação após falha.

Artefatos: `output/playwright/ux-review-20260918/`. Logs:
`/tmp/importacao-ux-review-20260918/`. Scripts de auditoria dentro de output são reproduzíveis,
mas não integram a suíte permanente e podem ser removidos pela limpeza de artefatos.

## Achados confirmados e priorizados

### UX-01 — ALTO: Câmbios transforma indisponibilidade em saldo zero/nenhum registro

**Reprodução:** abrir Câmbios com `/api/processes` retornando 503. A página continua pedindo
seleção de processo, sem informar que a consulta falhou. Com a lista carregada, selecionar
um processo e devolver 503 para `/api/currency-exchange/process/1`: aparecem quatro totais
zero e "Nenhum cambio registrado / Adicione um novo cambio para este processo".

**Impacto:** o usuário pode interpretar falha como ausência de operação financeira e tentar
cadastrar novamente. Não foi demonstrada duplicação real; o risco decorre da informação exibida.

**Causa:** `CurrencyExchangePage.tsx:60` e `:66` consomem somente data/isLoading; em `:464`,
ausência de dados cai no EmptyState. Erros de leitura não possuem ramo próprio.

**Correção proposta:** ErrorState com retry para lista e câmbios; ocultar os totais sem fonte
válida e distinguir vazio confirmado de erro. Testar falha inicial, falha após seleção e recuperação.
Evidências: `errors.json`, `flows.json` e `cambios-falha-exchanges.png`.

### UX-02 — MEDIO: contraste insuficiente em textos e indicadores dos dois temas

Axe encontrou **159 ocorrências de elementos** com contraste insuficiente em **59 de 92
varreduras**, abrangendo **36 das 46 URLs/abas avaliadas**. São ocorrências por viewport/tema,
não 159 componentes independentes. Exemplos conferidos:

| Local                                         | Contraste medido | Fonte                            |
| --------------------------------------------- | ---------------- | -------------------------------- |
| Aviso de acesso no login claro                | 2,63:1           | `LoginPage.tsx:190`              |
| Aviso de acesso no login escuro               | 3,74:1           | `LoginPage.tsx:190`              |
| Ação verde do Portal, texto branco            | 3,65:1           | `PortalPage.tsx`                 |
| Valor de Espelhos Gerados no executivo escuro | 2,40:1           | `ExecutiveDashboardPage.tsx:293` |

Nesses casos o motor exige 4,5:1 pelo tamanho/peso do texto. O indicador do executivo usa
`text-pink-700` sem variante escura. Há também datas, badges e textos auxiliares afetados.

**Correção proposta:** ajustar pares de tokens de texto/fundo e variantes dark; priorizar números,
ações e estados de negócio. Revalidar o elemento renderizado nos dois temas. Não basta trocar
uma cor global sem conferir os fundos semitransparentes. Evidência completa: `accessibility.json`.

### UX-03 — MEDIO: regiões roláveis não oferecem acesso adequado por teclado

Regra `scrollable-region-focusable` em 11 varreduras, 12 elementos: pipeline do executivo,
Compras/Pagamentos, Follow-Up e tabelas de Pré-Cons, Proformas, Comparativo, Registro, Câmbios
e Espelho no detalhe do processo. O layout contém corretamente o overflow, mas não garante que
quem usa teclado consiga alcançar e rolar todo o conteúdo.

Exemplo: `ExecutiveDashboardPage.tsx:401`, container `overflow-x-auto` sem foco nem descendente
interativo. **Correção:** região focável e nomeada quando necessário, foco visível, indicação de
rolagem e ensaio de setas/Tab, preservando todas as colunas. Não tornar indiscriminadamente todos
os containers focáveis. Evidência: seletores/HTML em `accessibility.json`.

### UX-04 — MEDIO: gráficos sem nome acessível

Regra `svg-img-alt`: seis varreduras, incluindo dashboards operacional, executivo e certificação.
Elementos SVG de séries/setores são expostos sem nome acessível. Evidência no executivo:
`ExecutiveDashboardPage.tsx:551`; operacional: `DashboardPage.tsx:596`.

**Correção:** nome/resumo do gráfico e alternativa textual ou tabular com os valores; evitar que
cada fragmento decorativo vire uma imagem sem contexto. Validar com árvore acessível e leitor de
tela. A ausência foi automatizada; não foi realizado ensaio humano com leitor de tela.

### UX-05 — MEDIO: rascunho do novo processo é perdido sem aviso

Preencher código e exportador, clicar "Voltar para lista de processos" e retornar ao formulário:
nenhum diálogo aparece e o código volta vazio. Comprovado em navegador, sem salvar qualquer dado.
`ProcessCreatePage.tsx:110` e `:480` navegam diretamente.

**Correção:** aviso de alterações não salvas ao sair, com ação segura de permanecer; opcionalmente
rascunho local com política explícita. Não inferir perda em todos os formulários: a reprodução
desta rodada foi no novo processo. Evidência: `flows.json`, `processo-rascunho-navegacao`.

### UX-06 — MEDIO: Pré-Conferência atribui falha 503 a permissões e não oferece retry

Com falha de serviço, a tela diz "Erro ao carregar divergencias. Verifique suas permissoes".
Há erro visível, porém sem retry e sem anúncio `role=alert` nesse banner. A pessoa é orientada
a investigar acesso quando o problema injetado é indisponibilidade.

Fontes: `PreConsPage.tsx:142`, `:730` e `:1000`. **Correção:** diferenciar 401/403 de falha de rede
ou 5xx; permitir tentar novamente e anunciar o erro. Evidência: `errors.json` e captura da rota.

### UX-07 — BAIXO: filtro permite intervalo invertido sem orientação junto aos campos

De `31/12/2026` até `01/01/2026`: inputs continuam válidos no navegador, sem min/max ou aviso,
e a requisição é enviada. `DateRangeFilter.tsx:35` e `:50`.

A API **já rejeita** intervalo invertido em `processFilterSchema`; não é uma falha de integridade.
O teste de interface usa fixtures que não executam essa validação de backend.
**Correção:** limites relacionados e mensagem próxima dos campos antes de consultar, mantendo
a validação da API. Evidência: `flows.json`, `intervalo-invertido`.

### UX-08 — BAIXO: título da aba não acompanha navegação e foco permanece no menu

Navegar de Dashboard para Processos mantém `document.title = Importação - Sistema de Gestão`
e o foco no link do menu. O h1 visual muda corretamente para Processos.
**Correção proposta:** título por rota e anúncio/foco de navegação que não interrompa ações
internas. Não afirmar que a página se torna inutilizável: há link de pular para o conteúdo.
Evidência: `flows.json`, `navegacao-titulo-foco`.

### UX-09 — BAIXO: semântica de títulos, tabelas e mensagens precisa de uniformização

18 varreduras com salto de níveis de heading; dois cabeçalhos vazios no Comparativo repetidos
nos dois viewports; um landmark sem nome único no Assistente e h1 ausente no login móvel.
Ao acessar área administrativa como analyst/viewer, aparece "PÁGINA NÃO ENCONTRADA" junto de
"Acesso restrito". A autorização bloqueia corretamente; o texto mistura causas distintas.

**Correção:** nomes acessíveis para colunas auxiliares sem mudar colunas visíveis, hierarquia
coerente, nomes distintos de landmarks e componente de acesso negado com mensagem própria.
Fontes: `accessibility.json`, `extra.json` e `app/routes.tsx:153`.

## Melhorias de produto, sem classificar como regressão

- No detalhe do processo, o resumo extenso empurra as abas operacionais para baixo. Conferir
  prioridade das informações e permitir resumo recolhível, preservando dados e fontes.
- No móvel, tabelas extensas têm rolagem interna, mas ações/colunas à direita ficam pouco
  descobríveis. Indicar a rolagem, tornar foco explícito e considerar fixar a coluna identificadora.
- A recomendação Cultura Builder de alvos de toque de 44 px não está uniforme: "Novo processo"
  mede 36 px de altura; inputs/selects avaliados ficam em 40–41 px. Isso não equivale automaticamente
  a uma falha WCAG 2.2 AA de tamanho de alvo. O CSS coarse atual cobre botões, não todos esses links/campos.
- Configurações de Certificação expõe detalhes de implementação (porta, tabelas e temporização)
  em meio ao fluxo operacional. Priorizar saúde, última atualização e ação recuperadora;
  manter diagnóstico técnico em área secundária, se necessário.

## O que funcionou

- Navegação móvel: foco inicial, ciclo de Tab/Shift+Tab, Escape e retorno ao acionador.
- Modais e formulários já cobertos na matriz: Novo Agendamento, usuário, drawer SYDLE e restrição
  individual de certificado, inclusive 320 px/paisagem.
- Recuperação do executivo após 503 pelo botão "Tentar novamente".
- Bloqueio visual de áreas administrativas para analyst e viewer, sem ampliar permissões.
- Fluxos de composição/confirmação de e-mail e configuração SMTP no sandbox.
- Produtos e Cadastro de Certificação sem violações Axe nos dois estados básicos avaliados;
  isso não é certificação completa de acessibilidade desses módulos.

## Cobertura e execução

- Matriz principal: **63 testes aprovados / 374 combinações**, 375/768/1440 px, claro/escuro; menus móveis não são exercitados em 1440 px.
- Extremos: 8 cenários × 320/844 px × 2 temas = **32 combinações**, 8 testes aprovados.
- Marketplace, ausente da matriz permanente: **6 combinações** em 320/768/1440 px, dois temas,
  sem overflow de documento/main, mais as duas varreduras Axe.
- Axe: **92 varreduras de 46 URLs/abas**, zero erro de execução ou fixture não atendida.
  Foram registradas **215 ocorrências de elementos** em sete categorias; inclui boas práticas
  e repetições por tema/tela. Não apresentar esse número como 215 defeitos independentes.
- Erros: **29 páginas** submetidas a 503. As telas que mostraram erro genérico ou botão com outro
  nome foram revisadas pelo conteúdo; ausência de `role=alert` não foi tratada sozinha como falso vazio.
- Web: `npm test -w apps/web`, **426 testes aprovados / 61 arquivos**.
- E-mail: `npm run test:e2e:web -- apps/web/e2e/email-workflows.spec.ts --reporter=list --output=output/playwright/ux-review-20260918/email-results`, **4 aprovados**.

Comandos da matriz:

```bash
AUDIT_ASSERT=1 AUDIT_VIEWPORTS=375,768,1440 AUDIT_THEMES=light,dark \
  AUDIT_OUT=output/playwright/ux-review-20260918/responsive \
  npm run test:e2e:web -- apps/web/e2e/responsive-audit.spec.ts \
  --project=chromium-desktop --fully-parallel --workers=3 --reporter=list \
  --output=output/playwright/ux-review-20260918/test-results

AUDIT_ASSERT=1 AUDIT_VIEWPORTS=320,844 AUDIT_THEMES=light,dark \
  AUDIT_ONLY='^(imp-(dashboard-menu|processo-novo|processo-editar|config-users-modal|sydle-drawer)|cert-(cadastro|agendamentos-form|item-restriction))$' \
  AUDIT_OUT=output/playwright/ux-review-20260918/edges \
  npm run test:e2e:web -- apps/web/e2e/responsive-audit.spec.ts \
  --project=chromium-desktop --fully-parallel --workers=2 --reporter=list \
  --output=output/playwright/ux-review-20260918/edge-results
```

Scripts dirigidos executados com `npx --no-install tsx output/playwright/ux-review-20260918/<script>.ts`:
`audit.ts`, `errors.ts`, `flows.ts`, `extra.ts`, `chart.ts`.

Total visual: **412 combinações sem quebra global** (374 + 32 + 6). Galeria filtrável em
`output/playwright/ux-review-20260918/galeria.html`; inventário versionado em
[matriz de cobertura](UX-UI-2026-09-18-COBERTURA.md).

## Limites e próximos passos

Fixtures comprovam comportamento de interface, não exatidão de dados reais nem autenticação Google,
envio de e-mail, sincronização Sheets/Linx, upload de documentos reais ou integração produtiva.
Chromium não substitui Safari/Firefox/dispositivos físicos; não houve ensaio humano com leitor de
tela. Estados de loading/empty têm cobertura estática e dos testes existentes; nem toda combinação
de todos os campos, permissões e erros foi exercitada. Não declarar revisão universal de cada estado.

Capturas full-page expandem o shell e podem reiniciar/redimensionar Recharts. Uma aparente
compressão dos gráficos foi descartada como achado de produto após conferir o viewport real
com scroll e espera de estabilização (`executivo-chart-real-viewport.png`).

Ordem de correção sugerida: UX-01; contraste e teclado (UX-02 a UX-04); proteção de rascunho e
recuperação (UX-05/06); consistência (UX-07 a UX-09). Acrescentar Marketplace e verificações Axe à
regressão permanente, com revisão dos achados e sem suprimir regras para obter resultado verde.

Não foi necessário repetir build/typecheck de aplicação: esta rodada alterou apenas documentação
e artefatos de auditoria, sem código compilado. Resultados anteriores não foram reutilizados como
se fossem novos testes desta revisão.

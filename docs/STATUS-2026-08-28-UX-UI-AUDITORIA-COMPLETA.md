# Status 2026-08-28 — Auditoria completa de UX/UI

## Objetivo

Revisar o frontend inteiro do sistema de Importação e Certificações, em desktop
e mobile, corrigindo problemas transversais de layout, responsividade,
acessibilidade e interação sem alterar contratos de negócio ou APIs públicas.

## Escopo observado

- Todas as 34 URLs funcionais e os cinco redirecionamentos declarados no
  roteamento foram renderizados em Chromium desktop e Pixel 7 simulado.
- Os componentes compartilhados, menus, modais, filtros, formulários,
  dashboards, páginas de Importação e páginas de Certificações foram revisados
  estaticamente.
- Login, dashboard, menu móvel e temas claro/escuro receberam inspeção visual
  interativa pelo Playwright CLI.
- Os fluxos de composição de e-mail e configuração SMTP foram exercitados em
  desktop e mobile com contratos simulados, sem envio real de mensagem.

## Diagnóstico observado

1. O menu móvel fechado permanecia acessível por teclado e por tecnologias
   assistivas; também faltavam bloqueio de scroll, fechamento por `Escape`,
   contenção de foco e restauração do foco.
2. Modais repetiam implementações incompletas de foco e `Escape`.
3. Cartões, abas, cabeçalhos ordenáveis e linhas clicáveis do dashboard não
   expunham toda a semântica de interação via teclado.
4. Tooltips dependiam apenas de mouse e havia botões de ícone ou campos de
   formulário sem nome programático suficiente.
5. Filtros de data e alvos de toque tinham comportamento inconsistente no
   mobile; inputs pequenos podiam provocar zoom automático no iOS.
6. Accordions e expansores não relacionavam de forma consistente controle e
   painel com `aria-expanded` e `aria-controls`.

## Implementação

### Fundações globais

- `AppLayout` agora torna o menu móvel fechado realmente inerte, oculta-o da
  árvore de acessibilidade, bloqueia o scroll quando aberto, contém o foco,
  fecha com `Escape` e devolve foco ao botão de abertura.
- `ModalPortal` passou a centralizar foco inicial, contenção de `Tab`,
  fechamento por `Escape`, restauração de foco e bloqueio de scroll, inclusive
  para modais aninhados.
- Foco visível, alvos mínimos de toque, tooltips por teclado, tamanho de fonte
  de formulários no mobile e largura mínima da aplicação foram normalizados no
  CSS global.
- Estados de carregamento, vazio e erro ganharam semântica e nomes acessíveis
  consistentes.
- O seletor de tema agora funciona como menu acessível, com setas,
  `Home`/`End`, `Escape`, estado selecionado e restauração de foco.

### Páginas e fluxos

- O dashboard SLA recebeu abas e painéis semânticos, ordenação acessível,
  cartões com estado pressionado e linhas navegáveis por teclado.
- Modais de Configurações, Comunicações, Agendamentos de Certificação,
  visualização documental e detalhe de pagamentos passaram a usar a fundação
  compartilhada.
- Accordions de Follow Up, Documentos, E-mails e Atendimentos agora expõem
  estado e relacionamento com seus painéis.
- Campos de comparativo, Espelho, Pre-Cons, Atendimentos, etapas customizadas,
  Erros + Custos Extras, cabeçalho do processo, filtros salvos e checklist de
  validação receberam rótulos programáticos quando necessário.
- Filtros de período foram reorganizados com `fieldset`, legenda e layout
  responsivo.

## Evidências

- Varredura AST de todos os arquivos TSX: zero `input`, `select` ou `textarea`
  potencialmente sem rótulo; zero botão potencialmente sem nome acessível.
- Smoke final de rotas: 78/78 cenários aprovados, cobrindo 39 URLs/redirects em
  desktop e mobile, sem exceção de página, erro de console ou overflow global.
- E2E de e-mail: 4/4 aprovados em desktop/mobile.
- Testes unitários: API 1.002 aprovados e um skip explícito; web 146 aprovados.
- Lint, typecheck e build de produção do monorepo aprovados.
- Testes novos cobrem o menu móvel e o contrato de foco do `ModalPortal`.

Comandos finais executados:

```text
npx eslint apps/web/src
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:web -- --grep 'renders|redirects'
npx playwright test apps/web/e2e/email-workflows.spec.ts --config=playwright.config.ts
```

## Segurança e riscos

- Não houve mudança de autenticação, autorização, tenant, banco ou contrato de
  API nesta frente.
- Nenhuma chamada destrutiva, migração, push ou deploy foi executada.
- A contenção de foco e o estado `inert` reduzem interação acidental com
  conteúdo de fundo em menus e modais.
- Risco residual `BAIXO`: os smokes usam contratos de API simulados. Dados reais
  excepcionalmente longos ou volumosos ainda merecem uma rodada visual de
  homologação, embora o gate de overflow cubra todas as rotas com fixtures.
- A auditoria melhora materialmente acessibilidade, mas não equivale a uma
  certificação formal WCAG com tecnologias assistivas reais.

## Estado de retomada

- Implementação e validações locais concluídas.
- Próximo passo seguro: homologação com usuários e dados representativos;
  depois, release/deploy em janela autorizada.

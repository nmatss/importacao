# Revisao UX/UI, Dados E Seguranca - 2026-06-17

## Escopo

Auditoria completa das rotas web, botoes, navegacao, duplicidade de dados e fluxo de importacao documental.

Rotas revisadas:

- Portal e login: `/portal`, `/login`.
- Importacao: dashboard, meu dia, executivo, processos, detalhe/edicao, pre-cons, cambios, LIs/LPCOs, desembaraco, numerario, follow-up, comunicacoes, alertas, ingestao de e-mail, auditoria e configuracoes.
- Certificacoes: dashboard, validacao, produtos, cadastro, relatorios, agendamentos e configuracoes.

## Correcoes Aplicadas

### UX/UI E Acessibilidade

- Removida busca global falsa dos sidebars de Importacao e Certificacoes.
- Incluida rota `/importacao/meu-dia` no menu lateral e no titulo do layout.
- Corrigido titulo do layout para `/importacao/processos/:id/editar`.
- Alinhados botoes de abrir/fechar/recolher menu e sair com `type="button"` e `aria-label`.
- Garantido destino do skip link `#main` em Login, Portal, Importacao e Certificacoes.
- Tabela de processos ganhou navegacao por teclado com `role="link"`, `tabIndex`, `Enter` e `Space`.
- Filtros de data ganharam `aria-label` para inicio/fim.
- Abas do detalhe do processo ganharam `tablist`, `tab`, `tabpanel`, `aria-selected`, `aria-controls` e `aria-labelledby`.
- Botoes icon-only da lista de documentos ganharam nomes acessiveis.
- Menu de Importacao passou a usar nomes mais claros: `Assistente`, `Atendimentos` e `Central de Alertas`.
- Criada tela `/importacao/assistente` com pergunta operacional, filtro opcional por processo, atalhos, resposta e lista de fontes internas.
- Paginas de Alertas e Atendimentos ganharam exportacao CSV baseada nos filtros ativos.
- Nomenclatura revisada em telas centrais para reduzir termos sem acento, mistura PT/EN e rotulos tecnicos.
- Complemento 2026-06-18: tabela de Produtos de Certificacoes passou a usar
  botoes focaveis com `aria-sort`; filtros de status/marca expõem
  `aria-pressed`; switches de agendamentos/usuarios e seletor de tema expõem
  estado acessivel.
- Complemento 2026-06-18 fase 2: upload de documentos virou controle acessivel
  com validacao client-side e progresso; sidebar recolhida ganhou nomes
  acessiveis; rotas internas invalidas ganharam fallback contextual; login
  mobile deixou de estourar largura; linhas de tabelas operacionais ganharam
  navegacao por teclado; abas de processo mantem labels no mobile; filtros de
  Pre-Cons, processos e certificacoes ganharam labels programaticos.
- Complemento 2026-06-18 fase 2: processos, cambios e agendamentos de
  certificacao passaram a bloquear valores/datas/cron invalidos antes da
  persistencia; telas de produtos, relatorios e agendamentos diferenciam falha
  de API de lista vazia.

### Duplicidade De Dados

- Aba de e-mails do processo reutiliza os logs ja carregados pelo detalhe quando disponiveis.
- Aba de cambios reutiliza os totais ja carregados pelo detalhe quando disponiveis.
- Card de Informacoes do Processo manteve a visao consolidada com fonte por campo e deixou de repetir o bloco bruto de `aiExtractedData`.
- Relatorios CSV de alertas e atendimentos reutilizam a lista ja filtrada em tela, evitando nova superficie duplicada para o mesmo dado.

### Seguranca E Importacao

- Comunicacoes nao aceitam mais anexos com `path` livre vindo da API.
- Envio de e-mail resolve anexos apenas por `documentId` ou `espelhoId` vinculados ao mesmo processo.
- Rascunhos legados com `path` so enviam se o caminho bater exatamente com documento/espelho do processo.
- Trigger, varredura historica e reprocessamento de ingestao de e-mail agora exigem usuario admin.
- Query da ingestao de e-mail agora e validada no local correto (`query`) e com schema coerente com o controller.
- Anexos recebidos por e-mail passam a respeitar limite maximo configuravel por `EMAIL_ATTACHMENT_MAX_BYTES` ou 50 MB.
- Testes negativos cobrem anexo legado fora do processo e teste positivo cobre resolucao por documento do processo.
- Acao "Enviar para Fenicia" do espelho agora cria comunicacao, envia SMTP real com anexos auditaveis e so marca o espelho/processo apos sucesso.

## Evidencias Principais

- Rotas: `apps/web/src/app/routes.tsx`.
- Layout Importacao: `apps/web/src/shared/components/ImportacaoLayout.tsx`.
- Layout Certificacoes: `apps/web/src/shared/components/CertificacoesLayout.tsx`.
- Detalhe do processo: `apps/web/src/features/processes/ProcessDetailPage.tsx`.
- Lista de processos: `apps/web/src/features/processes/ProcessListPage.tsx`.
- Lista de documentos: `apps/web/src/features/documents/DocumentList.tsx`.
- Card do processo: `apps/web/src/features/processes/components/ProcessInfoCard.tsx`.
- Comunicacoes: `apps/api/src/modules/communications/schema.ts` e `apps/api/src/modules/communications/service.ts`.
- Ingestao de e-mail: `apps/api/src/modules/email-ingestion/routes.ts`, `controller.ts`, `schema.ts` e `processor.ts`.
- Assistente RAG: `apps/api/src/modules/assistant/service.ts`, `apps/api/src/modules/assistant/routes.ts` e `apps/web/src/features/assistant/AssistantPage.tsx`.
- Exportacao CSV: `apps/web/src/shared/lib/csv.ts`, `apps/web/src/features/alerts/AlertsPage.tsx` e `apps/web/src/features/communications/CommunicationsPage.tsx`.

## Achados Pendentes

### P1

- Definir semantica unica de aceite entre checklist de validacao, comparativo documental e timeline.
- Ao deletar ou reprocessar documento, limpar/recalcular `aiExtractedData` por tipo e invalidar comparativo/espelho derivado.

### P2

- Criar hooks de dominio e padronizar query keys (`processKeys`, `documentKeys`, `followUpKeys`, `validationKeys`).
- Unificar cache do endpoint `/api/documents/process/:id/comparison`.
- Reduzir repeticao entre checklist, relatorio de validacao e comparativo dentro da aba Comparativo.
- Persistir checklist de Draft BL no backend ou deixar claro no produto que e anotacao local.
- Migrar modais especificos restantes de Settings/Agendamentos para Dialog
  compartilhado com foco gerenciado completo.
- Fortalecer formularios de Settings, Communications e CertCadastro com validacao
  por campo e testes.
- Criar UX mobile dedicada para tabelas largas e kanban operacional.

## Validacao

- `npm run -w apps/web typecheck`
- `npm test -w apps/web`
- `npm run -w apps/api typecheck`
- `npm test -w apps/api`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Playwright MCP em desktop/mobile para 28 rotas, verificando overflow,
  controles sem label, botoes sem nome e fallback de rotas invalidas.

Observacao: uma tentativa com `npm test -w apps/api -- --runInBand` falhou porque o Vitest atual nao aceita `--runInBand`; a suite foi executada com o comando padrao e passou.

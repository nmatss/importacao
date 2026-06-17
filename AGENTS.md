# AGENTS.md - Harness Operacional do Projeto Importacao

Este arquivo define as regras permanentes para agentes de engenharia atuando neste repositorio.
Ele complementa as instrucoes do ambiente de execucao e nao substitui regras de seguranca,
permissoes do usuario, nem politicas de ferramentas.

## Papel Do Agente

Atue como harness principal do projeto, cobrindo simultaneamente as disciplinas:

- CTO, arquiteto de software, arquiteto cloud e tech lead.
- DBA senior, arquiteto de dados e especialista DW.
- DevOps, seguranca, observabilidade e performance.
- QA lead, product manager, analista de negocio e especialista UX.
- Especialista de documentacao, compliance e operacao.

O objetivo e manter o projeto em estado Enterprise Ready: documentado, seguro,
escalavel, observavel, auditavel e operavel.

## Fontes Obrigatorias De Contexto

Antes de concluir qualquer analise relevante, consulte as fontes aplicaveis:

- Codigo em `apps/api`, `apps/web`, `apps/cert-api`, `scripts` e `infra`.
- Documentacao em `README.md`, `CHANGELOG.md` e `docs/`.
- Prompt portavel do harness em `docs/HARNESS_PROMPT.md`.
- ADRs em `docs/adr/` e indice de compatibilidade em `docs/ADR/README.md`.
- Migrations em `apps/api/drizzle/` e schema em `apps/api/src/shared/database/schema.ts`.
- Configuracoes em `.github/`, `docker-compose*.yml`, `.env.example`, `.env.sops.yaml.example`.
- Historico git, especialmente commits recentes e documentos `docs/STATUS-*`.
- Memorias: `docs/PROJECT_MEMORY.md`, `docs/SESSION_MEMORY.md`,
  `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md`, `docs/ROADMAP.md`.

Nunca trate suposicao como fato. Quando houver inferencia, marque como inferencia
e indique o grau de confianca.

## Workflow Obrigatorio

Antes de alterar arquivos:

1. Analisar contexto e evidencias.
2. Entender impacto tecnico, operacional, dados, seguranca e UX.
3. Criar plano quando a mudanca tiver mais de um passo.
4. Validar o plano contra o padrao existente do repositorio.

Depois de implementar:

1. Revisar diff.
2. Rodar testes proporcionais ao risco.
3. Rodar `npm run typecheck`, `npm test`, `npm run lint` e `npm run build` quando a mudanca tocar API/web compartilhado ou fluxo critico.
4. Atualizar documentacao, memoria, changelog ou ADR quando a decisao alterar comportamento, arquitetura ou operacao.
5. Registrar pendencias em `docs/KNOWN_ISSUES.md`, `docs/TECH_DEBT.md` ou `docs/ROADMAP.md`.

## Qualidade E Arquitetura

Decisoes devem considerar:

- Escalabilidade, seguranca, performance, custos e manutencao.
- Governanca, auditoria, operacao e observabilidade.
- Contratos entre frontend, API, banco, jobs e integracoes.
- Testabilidade e regressao operacional.

Preferir padroes existentes. Nao criar abstracao nova sem reduzir complexidade
real ou alinhar contratos entre modulos.

## Banco De Dados

Sempre que tocar dados:

- Verificar `schema.ts`, migrations e usos em services/controllers.
- Avaliar indices, integridade, cascata, auditoria e historico.
- Evitar migrations destrutivas sem plano de rollback e backup.
- Considerar impacto em producao e no script `scripts/deploy.sh`.

## Seguranca

Auditar explicitamente:

- Auth, AuthZ, JWT, OAuth, sessoes, roles e grupos Google.
- Secrets, logs, redaction e variaveis de ambiente.
- Uploads, magic bytes, path traversal, SSRF, XSS, CSRF, SQL injection, IDOR, RCE, LFI/RFI.
- Egress de IA e integracoes externas.

Classificar riscos como `CRITICO`, `ALTO`, `MEDIO` ou `BAIXO`.

## Git, Commit E Deploy

- Antes de commit, mostrar arquivos alterados, motivo e impacto quando solicitado.
- Usar Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `perf:`, `security:`, `chore:`.
- Nunca fazer push sem autorizacao explicita do usuario.
- Deploy de producao exige master limpo e sincronizado; usar `scripts/deploy.sh`.
- O servidor de producao e rsync-based, nao e repo git. Rollback do deploy e por snapshot de codigo.

## Formato Recomendado Para Analises Amplas

Para auditorias, revisoes enterprise e tarefas de harness, responder com:

- Objetivo Identificado
- Diagnostico
- Evidencias
- Arquitetura
- Banco De Dados
- Seguranca
- Performance
- Documentacao
- Riscos
- Plano
- Alteracoes
- Testes
- Atualizacao De Memoria
- Proximos Passos

Para tarefas pequenas, respostas objetivas sao aceitaveis desde que nao escondam
riscos ou testes relevantes.

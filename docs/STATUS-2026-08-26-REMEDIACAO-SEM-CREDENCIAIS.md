# Status — Remediação Sem Credenciais E Release

Data: 2026-08-26

Sessão do harness: `2acaf72b-993b-4eae-a445-25c809ab59dc`

Baseline: `5b9ec85bc1aa10cefb1ccf6bb8a4f4801556671f`

## Objetivo

Encerrar todo trabalho seguro que não depende de nova credencial ou decisão de
negócio, repetir a revisão página a página e preparar o release pelo runner
oficial. Operações externas mutáveis continuaram proibidas: nenhum envio real,
cadastro/retry Linx, sync, replay documental ou alteração remota de banco foi
usado como teste.

## Fatos Observados

- O workspace estava limpo e `master`, `origin/master` e produção estavam no
  mesmo baseline antes da mudança.
- O audit npm tinha seis moderadas: duas de runtime no React Router 6 e quatro
  no tooling via `drizzle-kit -> @esbuild-kit -> esbuild`.
- O projeto já tinha adotado os dois future flags do React Router 6, usa React
  18 e runtime Node compatível com Router 7.
- `drizzle-kit` atual ainda declara `@esbuild-kit/esm-loader`, pacote abandonado
  e incorporado ao `tsx`; o binário distribuído não importa APIs próprias desse
  loader.
- O CLI do Drizzle era hoisted para a raiz, enquanto `drizzle-orm` ficava apenas
  no workspace da API. Assim, o CLI não resolvia `drizzle-orm/version` ao checar
  migrations.
- O Pytest emitia warning de compatibilidade futura porque um iterador
  `itertools.product` era passado diretamente a `parametrize`.

## Alterações

- `react-router-dom` 6.30.4 -> 7.18.2 e remoção dos future flags que passaram a
  ser o comportamento padrão.
- Override restrito de `@esbuild-kit/esm-loader` para `tsx@4.22.4`, seguindo a
  orientação de depreciação upstream e eliminando o `esbuild` vulnerável.
- `drizzle-orm@0.45.2` também declarado como dev dependency da raiz, mantendo a
  dependência de runtime na API e tornando o CLI hoisted funcional.
- Produto cartesiano do teste Python materializado antes do `parametrize`.
- Novo `route-smoke.spec.ts`: 34 páginas e cinco redirects, com mocks de
  contrato por endpoint e stub local do SDK Google; é executado nos projetos
  Chromium desktop e Pixel 7 já configurados no repositório.

## Evidências Pré-Release

- `npm ci`: instalação limpa e reproduzível.
- `npm audit` e `npm audit --omit=dev`: zero vulnerabilidades.
- `drizzle-kit check`: migrations consistentes, sem conexão ou mutação do banco.
- `npm run format:check`, `npm run lint`, `npm run typecheck`: passaram.
- `npm test`: API 981 passaram + 1 skip; web 140 passaram.
- `npm run build`: API e web passaram; bundle de produção sem warning de chunk.
- Cert-API: 523 testes passaram; Ruff passou sem achados.
- `pip-audit -r apps/cert-api/requirements.txt`: nenhuma vulnerabilidade conhecida.
- `docker compose config --quiet`, `bash -n scripts/deploy.sh` e
  `git diff --check`: passaram.
- Playwright completo: 82/82 passaram — 34 páginas, cinco redirects e dois
  fluxos de e-mail/SMTP em desktop e mobile; zero exceção de página/console e
  zero overflow horizontal.

## Segurança

- **MÉDIO, corrigido:** open redirect por barra invertida e constructor injection
  no runtime do React Router.
- **MÉDIO, corrigido:** servidor de desenvolvimento `esbuild` vulnerável no
  tooling transitivo do Drizzle.
- **MÉDIO, residual aceito:** JWT em `localStorage`, conforme ADR 0003; migrar
  isoladamente exigiria cookies, CSRF e mudança coordenada do contrato de auth.
- Nenhum secret, valor de `.env`, payload de produção ou dado pessoal foi
  impresso ou versionado.

## Limitações E Bloqueios Externos

- IMAP, Google Drive, Odoo, Follow-Up Sheets e canal de alertas precisam de
  credencial, permissão, DNS, ID ou configuração externa válida.
- Contas pessoais do Linx devem ser substituídas por contas de serviço.
- Lacunas de Puket Escolares precisam de decisão fiscal; preenchimento inferido
  em massa não é seguro.
- Os 41 documentos abaixo de 90% de confiança, incluindo 16 `other`, precisam
  de ground truth/revisão humana. Estado processado não prova acurácia.
- Nenhum e-mail real foi enviado sem destinatário controlado aprovado; o fluxo
  mutável permanece provado por GreenMail/API e o browser usa interceptação.

## Rollback

- Código: snapshot criado pelo `scripts/deploy.sh` e retorno ao commit baseline.
- Dependências: restaurar `package.json`/lock do baseline e executar `npm ci`.
- Não há migration, backfill ou alteração de contrato de banco neste release.

## Estado De Retomada

Antes do deploy: revisar o diff, commitar com Conventional Commit, publicar
`master` e executar `scripts/deploy.sh` com o guard rail SYDLE já documentado.
Depois: confirmar `REVISION`, saúde interna e pública, logs do restart, headers
e smokes read-only. O resultado pós-release fica no checkpoint runtime desta
sessão para preservar `master` e produção no mesmo commit implantado.

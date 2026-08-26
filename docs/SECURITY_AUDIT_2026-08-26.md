# Auditoria De Segurança — 2026-08-26

## Escopo E Método

Revisão estática e dinâmica proporcional de Express/TypeScript, React/Vite e
FastAPI, com foco em autenticação, autorização, entrada de e-mail não confiável,
uploads, SMTP, logs, XSS, injeção, rate limit, CORS, dependências e exposição de
erros. Foram aplicadas as referências da skill `security-best-practices` para
Express, JavaScript/React e FastAPI.

Não houve pentest em produção, alteração de secret, envio de e-mail, deploy ou
escrita remota. As classificações seguem impacto potencial no produto.

## Achados Corrigidos

### ALTO — Reinterpretação Do Envelope SMTP Pelo `From`

O valor configurável aceitava sintaxe que o Nodemailer podia reinterpretar como
grupo/lista, fazendo `extractEmailAddress` e o envelope efetivo discordarem. A
correção introduziu parser de uma única mailbox, falha fechada no resolvedor e
validação Zod administrativa:

- `apps/api/src/shared/mail/mail-address.ts:1`
- `apps/api/src/shared/mail/mailer.ts:60`
- `apps/api/src/modules/settings/schema.ts:24`

Testes cobrem CR/LF, sintaxe de grupo, porta inválida e fechamento do transporte.

### ALTO — DoS Em Dependências Do Caminho De E-mail

`mailparser@3.9.10` trazia transitive advisories de alto impacto ao processar
HTML/linkificação não confiável; `undici@7.28.0` também possuía advisory alto.
Foram atualizados, sem major, para `mailparser@3.9.16` e `undici@7.29.0`.
`dompurify` e `react-router-dom` receberam os patches compatíveis disponíveis.

Evidência: `npm ls` confirmou as versões e
`npm audit --audit-level=high --omit=optional` terminou sem alto/crítico.

### MÉDIO — Dados Operacionais Em Logs

O request logger persistia `req.url`, incluindo buscas, fornecedor e referência
de processo. A query Gmail podia incluir remetente e assunto. O logger agora
usa apenas `req.path`, a busca Gmail registra somente flags e os principais
campos de e-mail/documento são redigidos:

- `apps/api/src/app.ts:63`
- `apps/api/src/modules/email-ingestion/gmail.service.ts:193`
- `apps/api/src/shared/utils/logger.ts:8`

Os caminhos aninhados de `Authorization` em erros de clientes HTTP
(`err.config/err.options`) também são censurados como defesa em profundidade.

### BAIXO — Detalhe Interno Na Resposta De Métricas

Uma falha de serialização retornava `String(err)` no endpoint protegido de
métricas. O detalhe permanece apenas no log redigido e a resposta é genérica:

- `apps/api/src/app.ts:113`

### ALTO — Acknowledgement De E-mail Após Crash

Um log em `processing` era tratado como “já processado” no poll seguinte. Se o
processo caísse depois da criação do log e antes do estado terminal, a mensagem
era marcada como lida sem o trabalho ter sido concluído. A correção adiciona
claim atômico e lease: owner ativo mantém a mensagem não lida, owner abandonado
é retomado após o limite configurado e estados terminais continuam idempotentes.

Evidência: o E2E SMTP/IMAPS cria simultaneamente uma lease ativa e uma vencida;
a vencida termina `ignored`, e somente a ativa permanece `processing` e não
lida.

### MÉDIO — Sanitização HTML Baseada Em Regex

O backend removia tags/event handlers por expressões regulares. HTML não é uma
linguagem regular e markup malformado, novas formas de URL ou CSS podiam escapar
de uma blacklist incompleta. O corpo agora passa por `sanitize-html` com
allow-list explícita de tags, atributos, esquemas e propriedades CSS antes de
persistir e novamente antes de enviar.

Testes removem `script`, `style`, SVG, iframe, handlers, `javascript:`, `data:` e
CSS fora da allow-list, preservando apenas a tabela e os estilos usados pelos
templates.

## Controles Confirmados

- Helmet está habilitado; CORS falha fechado em produção sem origem explícita;
  JSON/urlencoded possuem limite de 2 MB (`apps/api/src/app.ts:27`).
- Auth valida assinatura JWT e consulta usuário ativo/role no banco, sem confiar
  na role do cliente (`apps/api/src/shared/middleware/auth.ts:25`).
- Rotas de trigger/reprocess de e-mail exigem admin; trigger e probes possuem
  rate limit (`apps/api/src/modules/email-ingestion/routes.ts:20` e
  `apps/api/src/modules/settings/routes.ts:49`).
- Envio de comunicação exige autenticação, allow-list e limitador de dez por
  minuto (`apps/api/src/modules/communications/routes.ts:9`).
- HTML de assinatura/comunicação é sanitizado com DOMPurify antes de renderizar;
  o backend usa allow-list independente antes de persistir/enviar.
- Uploads usam limite, extensão, MIME/magic bytes, nomes gerados e processos
  filhos com `shell:false` no OCR.
- Cert-API compara API key com `hmac.compare_digest` e falha fechada quando a
  chave está ausente (`apps/cert-api/app/utils/auth.py:23`).
- Swagger é desabilitado por padrão em produção; métricas exigem token ou
  allow-list explícita.

## Riscos Residuais

### MÉDIO — JWT Em `localStorage` (Aceito Em ADR)

O token fica acessível a JavaScript. O ADR 0003 registra a decisão; o risco é
condicionado a XSS. Recomendação: manter CSP/DOMPurify, revisar toda nova
renderização HTML e planejar sessão em cookie HttpOnly se o produto aceitar a
mudança de CSRF/arquitetura.

### MÉDIO — Seis Advisories npm Sem Patch Compatível

- React Router 6: correção somente no major 7;
- Drizzle Kit tooling: advisory transitivo de esbuild, correção sugerida pelo
  audit implica mudança incompatível/downgrade;
- Testcontainers 11 foi atualizado para 12.1.0 e validado com todos os E2E,
  removendo o grupo `dockerode/uuid`.

No audit completo restam seis entradas moderadas (dependências e transitivas);
com `--omit=dev`, somente React Router/React Router DOM permanecem no runtime.

Não foi usado `npm audit fix --force`. Criar trilhas separadas de upgrade com
regressão de rotas, migrations e E2E.

### MÉDIO — Integrações Com Credenciais/IDs Inválidos Ou Inacessíveis

SMTP e IMAP recusaram autenticação; a raiz do Drive respondeu 404. Não há
evidência de comprometimento, mas há indisponibilidade. Validar conta, app
password/permissões e compartilhamento do folder; rotacionar credenciais apenas
se o responsável confirmar expiração ou exposição.

### BAIXO — Escopo Amplo Do Service Account Do Drive

O serviço usa `drive` completo porque cria/move estrutura e acessa uma raiz
compartilhada. Recomendação: validar em ambiente de teste se `drive.file` cobre
o fluxo; se não, limitar a service account a uma pasta dedicada e monitorar
operações fora dela.

## Resultado

Nenhum achado CRÍTICO foi confirmado. Os três achados ALTOS no código foram
corrigidos e testados, mas aguardam commit/deploy autorizado. Os bloqueios de
credencial/configuração impedem afirmar prontidão operacional de e-mail e Drive.

O gate final passou em lint, typecheck, 977 testes API, 131 testes web, 48 testes
E2E da API, quatro Playwright desktop/mobile, 509 testes Python, build,
`npm audit` para alto/crítico e `pip-audit`. O
`format:check` permanece vermelho apenas pelos mesmos 19 arquivos fora do padrão
já presentes no baseline.

# Security

Ultima atualizacao: 2026-06-17

## Controles Existentes

- Helmet e headers HTTP.
- Rate limiting em rotas sensiveis.
- JWT e Google OAuth.
- Restricao por dominio/grupo Google.
- Validacao magic-byte em uploads.
- Sanitizacao de HTML para emails/drafts.
- Anexos de comunicacoes resolvidos por `documentId`/`espelhoId` do mesmo processo; `path` livre de cliente nao e aceito.
- Acoes manuais de ingestao de e-mail (`trigger`, `history-scan`, `reprocess`) restritas a admin.
- Anexos recebidos por e-mail limitados por `EMAIL_ATTACHMENT_MAX_BYTES` ou 50 MB.
- Containers com `no-new-privileges`.
- Redis sem porta publica no compose prod.
- PostgreSQL exposto somente em `127.0.0.1:5450` no host.
- IA externa exige `AI_ALLOW_EXTERNAL=true`.
- IA local usa allowlist de hosts e bearer token.
- CodeQL SAST em `.github/workflows/codeql.yml`.
- `npm audit --audit-level=high` no CI.

Evidencias:

- `README.md`
- `docker-compose.prod.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `apps/api/src/shared/config/env.ts`
- `apps/api/src/shared/middleware`
- `docs/SECRETS.md`
- `docs/TLS.md`

## Riscos A Monitorar

### ALTO - Secrets E `.env`

`.env.sops.yaml` ainda ausente em producao; deploy usa `.env` existente.

Mitigacao:

- Criar `.env.sops.yaml`, criptografar com SOPS e documentar rotacao.

### ALTO - Egress De IA

Documentos comerciais contem dados sensiveis. Providers externos exigem decisao explicita.

Mitigacao:

- Manter `AI_ALLOW_EXTERNAL=false` ate decisao formal.
- Registrar ADR caso Vertex/OpenRouter seja habilitado.

### MEDIO - Uploads E Anexos

Magic-byte existe, mas qualquer mudanca no pipeline de email/upload deve manter
paridade de validacao. Comunicacoes nao devem reintroduzir anexos por caminho
arbitrario vindo do cliente.

Mitigacao:

- Testes de upload manual e email ingestion para PDF/XLS/XLSX.

### MEDIO - IDOR/AuthZ

Processos e documentos sao recursos multiusuario. Alteracoes em controllers devem
validar autenticacao e autorizacao.

Mitigacao:

- Revisar middleware de auth em todo novo endpoint.

## Checklist De Auditoria

Antes de entregar mudanca sensivel:

- Validar secrets em logs.
- Validar auth/authz.
- Validar inputs com Zod ou parser seguro.
- Validar uploads por tipo real.
- Validar SQL por ORM/query parametrizada.
- Validar egress externo.
- Validar que erros nao vazam segredo.

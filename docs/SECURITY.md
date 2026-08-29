# Security

Ultima atualizacao: 2026-08-29

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
- Proxy `/cert-api/` do Nginx valida o JWT do usuario via `auth_request` antes
  de injetar a chave interna `X-API-Key`, e desde 2026-08-29 decide tambem por
  ESCOPO (`cert.read` / `cert.operate` / `cert.admin`), fail-closed em rota
  desconhecida. As regexes de leitura recusam `%`, para que um escopo decidido
  sobre a URI bruta nunca conceda mais que o caminho que a cert-api de fato
  serve depois da normalizacao do Nginx.
- CodeQL SAST em `.github/workflows/codeql.yml`.
- `npm audit --audit-level=high` no CI.
- Rate limit com incremento ATOMICO (`cache.incr`), janela fixa e chave pelo
  caminho completo da rota. Antes era `get` + `set`, e uma rajada concorrente
  passava do limite.
- Login Google exige `email_verified`; o claim `hd`, quando presente, tem de
  bater com `ALLOWED_DOMAIN`. A checagem de `hd` e CONDICIONAL de proposito —
  ver o comentario em `modules/auth/service.ts` antes de endurecer.
- Admin nao consegue se auto-desativar nem se rebaixar, e o ultimo admin ativo
  e protegido.
- Metricas Prometheus rotulam pela rota REGISTRADA, nao pelo path bruto: path
  desconhecido nao cria serie nova.
- Conteudo de fonte externa que entra no prompt do assistente e delimitado,
  neutralizado e declarado como DADO, nunca como instrucao.
- `PUT /api/settings/:key` aceita apenas chaves de uma allow-list.

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

### BAIXO - Governanca Continua De Secrets

SOPS + age e `.env.sops.yaml` criptografado estao configurados para producao.
Risco residual: edicoes manuais de secrets fora do fluxo SOPS ou rotacao
incompleta de credenciais.

Mitigacao:

- Editar secrets apenas via `sops .env.sops.yaml`.
- Manter rotacao documentada em `docs/SECRETS.md`.
- Nunca commitar `.env.sops.yaml` descriptografado.

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

### MEDIO - AuthZ Fina Da Cert-API (reescrito em 2026-08-29)

A separacao por escopo FOI implementada: `cert-api-access.ts` classifica cada
rota em `cert.read`, `cert.operate` ou `cert.admin` e recusa rota desconhecida.

O risco residual mudou de lugar e ficou mais preciso: o modelo de papeis do
PORTAL so tem `admin` e `analyst`, e `cert.operate` — que inclui
`POST /cert-api/api/certificates`, ou seja, ESCRITA no ERP Linx de producao — e
concedido a todo `analyst`. Enquanto `ERP_*_USER` for conta pessoal, a escrita
sai sob a identidade de uma pessoa, e ela nao gera entrada em `audit_logs` do
portal (so na tabela do cert-api).

Mitigacao:

- Migrar `ERP_PUKET_USER` / `ERP_IMG_USER` para conta de servico antes de
  ampliar o papel `analyst`.
- Espelhar criacao e retry de certificado em `audit_logs` do portal.
- Introduzir um papel intermediario se a operacao precisar separar quem le de
  quem escreve no ERP.

## Checklist De Auditoria

Antes de entregar mudanca sensivel:

- Validar secrets em logs.
- Validar auth/authz.
- Validar inputs com Zod ou parser seguro.
- Validar uploads por tipo real.
- Validar SQL por ORM/query parametrizada.
- Validar egress externo.
- Validar que erros nao vazam segredo.

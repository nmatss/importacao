# Status 2026-09-16 — Login Google @imaginarium.com

## Objetivo Identificado

Liberar o login Google de colaboradoras com e-mail `@imaginarium.com` (caso
Isabela / relato Eduarda) e fazer o cadastro em Configuracoes > Usuarios
conceder acesso, sem alterar colunas nem dados de importacao.

## Diagnostico

Fato: a tela publica recusou `isabela.hoehne@imaginarium.com` com
`Acesso restrito a contas @grupounico.com`. Essa mensagem e emitida em
`authService.loginWithGoogle` quando o sufixo do e-mail ou o claim `hd` nao
bate com `ALLOWED_DOMAIN` unico.

Fato: o cadastro em Configuracoes > Usuarios grava a tabela `users` e nao
participava do login Google. Depois do dominio, so `GOOGLE_GROUP_ALLOWED`
(`importacao@grupounico.com` no env local) autorizava. Quem era so cadastrado
recebia `Acesso negado: usuário não pertence ao grupo autorizado`.

Fato (Admin Google, 16/09): a conta operacional e
`isabela.hochheim@imaginarium.com.br`, OU `imaginarium.com.br`, grupo
**Portal Importacao** `importacao.aut@grupounico.com`. O login tentado como
`@imaginarium.com` e a checagem de `importacao@grupounico.com` nao casam com
esse cadastro.

Hipotese (confianca alta): o Workspace emite `hd=grupounico.com` ou
`hd=imaginarium.com.br` para essa OU. Os dois precisam estar na allowlist.

Fora de escopo: colunas, documentos, follow-up, certificacao, Linx.

## Alteracoes

- `ALLOWED_DOMAIN` parseado como lista. SOPS/codigo:
  `grupounico.com,imaginarium.com,imaginarium.com.br`.
- `GOOGLE_GROUP_ALLOWED` parseado como lista. SOPS previsto:
  `importacao.aut@grupounico.com,importacao@grupounico.com`.
- Login Google: usuario local ativo cadastrado entra sem consultar o grupo;
  ausente na base continua exigindo um dos grupos e e auto-provisionado como analista.
- Textos da LoginPage e da aba Usuarios.

## Validacao

- `npm test -w apps/api -- src/modules/auth` + testes de grupo/allowlist: **133 passed**.
- `npm run typecheck` e `npm run lint`: ok. Prettier nos arquivos do login/grupo: ok apos `--write` em SettingsPage e allowed-domain.test. `git diff --check`: ok.
- Testes web LoginPage/Settings nao executaram: worker Vitest/jsdom falha com `ERR_REQUIRE_ESM` em `@exodus/bytes` via `html-encoding-sniffer`. Preexistente, nao e regressao do texto de login.
- SOPS do repositorio (extract so destes campos):
  `ALLOWED_DOMAIN=grupounico.com,imaginarium.com,imaginarium.com.br`;
  `GOOGLE_GROUP_ALLOWED=importacao.aut@grupounico.com,importacao@grupounico.com`.
- Deploy `6cbb9c2` em 192.168.168.124, sem `PUBLIC_WEB_HEALTH_ENDPOINT`.
  REVISION e container com `parseAllowedGroups`. `.env` remoto:
  `ALLOWED_DOMAIN=grupounico.com,imaginarium.com,imaginarium.com.br` e
  `GOOGLE_GROUP_ALLOWED=importacao.aut@grupounico.com,importacao@grupounico.com`.
  Health interno web/api/ready/cert 200. `curl -k` publico 200/200.
- Primeira tentativa com `PUBLIC_WEB_HEALTH_ENDPOINT` abortou no TLS local e
  rollback deixou codigo antigo com env novo. Segundo deploy sem esse check
  concluiu e alinhou codigo+env.

## Riscos

- `PUBLIC_WEB_HEALTH_ENDPOINT` a partir deste WSL continua falso-negativo sem a CA.
- Cadastro local passa a ser grant de acesso: desativar na aba Usuarios revoga
  mesmo quem permanece no grupo Google.
- Dominios adicionais de marca (ex. Puket) nao foram incluidos; entram via env.

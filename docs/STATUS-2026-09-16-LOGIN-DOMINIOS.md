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

Hipotese (confianca alta): `@imaginarium.com` e dominio de marca do mesmo
grupo economico; o token Google pode trazer `hd=grupounico.com` com e-mail de
marca, ou `hd=imaginarium.com`. Os dois casos precisavam estar na allowlist.

Fora de escopo: colunas, documentos, follow-up, certificacao, Linx.

## Alteracoes

- `ALLOWED_DOMAIN` parseado como lista. Codigo e exemplos:
  `grupounico.com,imaginarium.com`.
- Login Google: usuario local ativo cadastrado entra sem consultar o grupo;
  ausente na base continua exigindo o grupo e e auto-provisionado como analista.
- Textos da LoginPage e da aba Usuarios.

## Validacao

- `npm test -w apps/api -- src/modules/auth src/modules/integrations/__tests__/google-groups.service.test.ts --run`: **124 passed**.
- `npm run typecheck` e `npm run lint`: ok. Prettier nos arquivos do login: ok apos `--write` em SettingsPage e allowed-domain.test. `git diff --check`: ok.
- Testes web LoginPage/Settings nao executaram: worker Vitest/jsdom falha com `ERR_REQUIRE_ESM` em `@exodus/bytes` via `html-encoding-sniffer`. Preexistente, nao e regressao do texto de login.
- SOPS do repositorio: `grupounico.com,imaginarium.com` (extract so desse campo).
- Deploy `fcc6cc6` em 192.168.168.124. REVISION e container com `parseAllowedDomains`.
  `.env` remoto `ALLOWED_DOMAIN=grupounico.com,imaginarium.com`. Health interno
  web/api/ready 200. Curl publico estrito falha neste WSL por CA interna; `curl -k`
  devolve 200/200.
- Primeira tentativa com `PUBLIC_WEB_HEALTH_ENDPOINT` abortou no TLS local e
  rollback deixou codigo antigo com env novo. Segundo deploy sem esse check
  concluiu e alinhou codigo+env.

## Riscos

- `PUBLIC_WEB_HEALTH_ENDPOINT` a partir deste WSL continua falso-negativo sem a CA.
- Cadastro local passa a ser grant de acesso: desativar na aba Usuarios revoga
  mesmo quem permanece no grupo Google.
- Dominios adicionais de marca (ex. Puket) nao foram incluidos; entram via env.

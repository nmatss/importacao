# Status 2026-08-03 - Incidente de Login Google e Egress Docker

## Objetivo Identificado

Investigar o relato de Leticia Silva Bicca, recebido as 09:18 BRT, de que ela,
"Duda" e Odett nao conseguiam acessar a plataforma de Importacao. A associacao
de "Duda" ao cadastro de Eduarda foi inferida com confianca alta a partir do
nome e do horario da tentativa; pode ser confirmada com a operacao se necessario.

Esta analise foi somente diagnostica e read-only. Nenhuma configuracao, container,
arquivo de producao, dado ou permissao de usuario foi alterado.

## Diagnostico

O incidente foi confirmado. A causa imediata nao era cadastro, papel, senha,
dominio corporativo ou ausencia no Google Group. O container `importacao-api`
nao conseguia acessar `https://oauth2.googleapis.com/token` pela sua rota de
saida padrao e o login falhava durante a validacao obrigatoria de pertencimento
ao Google Group.

A causa tecnica confirmada, com confianca alta, e:

1. A API participa das redes Docker `importacao_default` e `ia-local-net`.
2. O gateway default do container estava em `ia-local-net`, via
   `192.168.208.1`.
3. Conexoes HTTPS originadas pelo endereco da API nessa rede
   (`192.168.208.4`) expiravam por timeout.
4. A mesma conexao, forcada pelo endereco `172.20.0.9` da rede
   `importacao_default`, recebia resposta do Google normalmente.
5. O host de producao e o `cert-api`, que nao dependiam da rota defeituosa,
   tambem acessavam o Google normalmente.

A causa subjacente da falta de egress em `ia-local-net` esta na camada de
rota/NAT Docker. O compose conecta a API a duas redes, mas nao declara
`gw_priority` para determinar explicitamente qual delas deve ser o gateway de
saida externa.

## Linha Do Tempo

Horarios abaixo em America/Sao_Paulo (BRT, UTC-3):

| Horario             | Evidencia                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 09:16:48-09:19:13   | Seis tentativas de Leticia falharam com HTTP 401; o erro interno real foi `ETIMEDOUT` no OAuth do Google.     |
| 09:18               | Relato operacional recebido.                                                                                  |
| 09:19:33 e 09:19:47 | Duas tentativas de Odett falharam pelo mesmo timeout.                                                         |
| 09:19:45            | Uma tentativa de Eduarda falhou pelo mesmo timeout.                                                           |
| 11:37:27-11:37:38   | As tres usuarias tiveram `login_google` bem-sucedido.                                                         |
| Apos 14:00          | Nova verificacao direta de membership voltou a falhar com `ETIMEDOUT`, confirmando intermitencia ainda ativa. |

Os timestamps persistidos no banco e nos logs dos containers usam UTC. A
conversao para BRT foi aplicada apenas nesta apresentacao.

## Evidencias

### Usuarios E Auditoria

Os tres usuarios existem no PostgreSQL de producao, possuem papel `analyst` e
estao ativos:

- `leticia.bicca@grupounico.com`
- `eduarda.souza@grupounico.com`
- `odett.hammes@grupounico.com`

O `audit_logs` registrou sucesso dos tres as 14:37 UTC. Nao houve evidencia de
`not_in_group`, conta desativada ou credenciais invalidas.

### Aplicacao E Containers

- `https://importacao.grupounico.com/` respondeu HTTP 200.
- `https://importacao.grupounico.com/api/health` respondeu HTTP 200.
- `importacao-api`, `importacao-web`, `importacao-cert-api`, PostgreSQL e Redis
  estavam `healthy`.
- Revisao remota: `b55968a1ded2527524113543cb5febc64c7fedd2`.
- O health check da API valida apenas API, banco e Redis; ele nao detecta perda
  de conectividade com Google Groups/OAuth.

### Rede

Resultados dos probes read-only:

- Host local -> Google OAuth: HTTP 404 esperado para `/`, conectividade OK.
- Host de producao -> Google OAuth: HTTP 404 esperado, conectividade OK.
- `cert-api` -> Google OAuth: HTTP 404 esperado, conectividade OK.
- API com rota default -> timeout.
- API com `localAddress=172.20.0.9` (`importacao_default`) -> HTTP 404 em 221 ms.
- API com `localAddress=192.168.208.4` (`ia-local-net`) -> timeout em 5 s.
- Consulta real `googleGroupsService.isAllowed()` -> `ETIMEDOUT`.

O `/proc/net/route` da API confirmou o default gateway em `eth0`, associado a
`192.168.208.1`/`ia-local-net`.

### Codigo

- `apps/api/src/modules/auth/service.ts`: o login Google valida o ID token,
  dominio e, antes de emitir o JWT local, chama
  `googleGroupsService.isAllowed(email)`.
- `apps/api/src/modules/integrations/google-groups.service.ts`: usa uma service
  account delegada para obter token e consultar membership no Admin Directory.
- `apps/api/src/modules/auth/controller.ts`: qualquer excecao do fluxo Google e
  atualmente convertida em HTTP 401, inclusive timeout de infraestrutura.
- `docker-compose.prod.yml`: a API esta ligada a `default` e `ia-local-net` sem
  prioridade explicita de gateway.

## Arquitetura

O comportamento de autorizacao continua fail-closed: se o Google Group nao
pode ser validado, nenhum JWT local e emitido. Isso preserva a seguranca, mas
faz a disponibilidade do login depender do egress do container da API.

O uso simultaneo das duas redes e necessario:

- `importacao_default`: banco, Redis, web, cert-api e egress externo.
- `ia-local-net`: acesso ao gateway on-prem da IA local.

A correcao nao deve remover `ia-local-net`; deve somente garantir que
`importacao_default` seja o gateway prioritario de saida.

## Banco De Dados

- Nenhum dado foi alterado.
- Nao ha migration envolvida.
- Os registros de usuario confirmam que nao e necessario recriar contas ou
  mudar papeis.
- Os eventos `login_google` preservam a evidencia de sucesso temporario.

## Seguranca

Classificacao: `ALTO` para disponibilidade e `BAIXO` para confidencialidade/
integridade.

- Nao foi identificado bypass de AuthN/AuthZ.
- O gate do Google Group falhou fechado.
- Nenhum segredo foi exibido ou copiado durante os probes.
- O retorno HTTP 401 para uma dependencia indisponivel e semanticamente
  incorreto e induz o usuario a suspeitar de conta ou senha. O erro deveria ser
  tratado como HTTP 503 com mensagem generica e correlation ID.

## Performance E Operacao

O problema pode atingir todo egress externo originado pela API, nao apenas o
login. Falhas contemporaneas do cron SYDLE com `fetch failed` corroboram esse
impacto. Google Drive, Sheets, Gmail, Google Chat, Odoo, SYDLE e providers de IA
externos devem ser revalidados depois da correcao.

O health check atual permaneceu verde durante o incidente. Nao e recomendado
transformar toda dependencia externa em readiness bloqueante, pois reiniciar a
API nao corrige indisponibilidade de terceiros. E preferivel criar probe
sintetico/alerta especifico de egress e autenticacao Google.

## Riscos

| Risco                                                                 | Severidade | Estado                         |
| --------------------------------------------------------------------- | ---------- | ------------------------------ |
| Todos os logins Google falharem durante perda de egress               | ALTO       | Aberto/intermitente            |
| Drive, Sheets, Gmail, Chat, Odoo e SYDLE falharem pela mesma rota     | ALTO       | Requer validacao apos correcao |
| Health checks declararem ambiente saudavel com Auth indisponivel      | MEDIO      | Aberto                         |
| Timeout externo ser apresentado como credencial invalida/HTTP 401     | MEDIO      | Aberto                         |
| Remover `ia-local-net` e interromper a IA local durante um workaround | ALTO       | Deve ser evitado               |

## Plano De Correcao Recomendado

1. Alterar `docker-compose.prod.yml` para declarar prioridade de gateway da
   rede `default` para o servico `api`, mantendo `ia-local-net` conectada.
2. Validar o compose com a versao instalada no servidor antes do rollout.
3. Fazer deploy pelo fluxo oficial e recriar somente os servicos necessarios.
4. Confirmar que o default gateway da API passou para `172.20.0.1`.
5. Validar conectividade com o Google usando probe sem segredo.
6. Executar uma verificacao real de membership das tres usuarias.
7. Retestar login pela URL publica e confirmar `/api/auth/me` autenticado.
8. Validar acesso ao gateway IA local e um fluxo documental controlado.
9. Validar Google Drive/Sheets/Gmail, Odoo e SYDLE.
10. Observar logs e metricas antes de declarar o incidente encerrado.

Melhorias de resiliencia posteriores:

- Mapear timeout/erro do Google para HTTP 503, sem expor detalhes internos.
- Registrar falha de infraestrutura de login separadamente de `not_in_group`.
- Criar alerta de egress Google e smoke test de login no deploy.
- Avaliar cache curto e seguro de membership positivo somente com decisao
  explicita sobre a janela aceitavel de revogacao de acesso.

## Alteracoes

Nenhuma alteracao de codigo, configuracao, banco ou producao foi feita durante
o diagnostico. Este documento e os indices de memoria foram criados depois, por
solicitacao explicita, para preservar a trilha operacional.

## Testes E Comandos Executados

Validacoes read-only executadas:

- `curl` na raiz publica e em `/api/health`.
- `docker compose -f docker-compose.prod.yml ps --format json`.
- consultas SQL somente leitura em `users` e `audit_logs`.
- `docker logs` da API e do web na janela do incidente.
- `docker network inspect`, `docker inspect` e leitura de `/proc/net/route`.
- probes HTTPS do host, `cert-api` e API, incluindo origem forcada por cada
  interface de rede.
- chamada read-only de `googleGroupsService.isAllowed()`.

Nao foram executados `npm test`, typecheck, lint ou build porque nenhum arquivo
de aplicacao foi alterado.

## Atualizacao De Memoria

- Pendencia aberta registrada em `docs/KNOWN_ISSUES.md`.
- Resumo operacional registrado em `docs/SESSION_MEMORY.md`.
- Estado duravel de infraestrutura registrado em `docs/PROJECT_MEMORY.md`.

## Mensagem Operacional Sugerida

> Bom dia, Leticia. Identifiquei uma instabilidade na conexao da plataforma com
> o Google que bloqueou o login de voces. Os cadastros da Leticia, Duda e Odett
> estao ativos e nao e necessario alterar senha. Houve acesso bem-sucedido
> posteriormente, mas a conectividade ainda esta intermitente e a causa tecnica
> ja foi localizada. Avisarei assim que o servico estiver estabilizado.

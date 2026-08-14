# Incidente 2026-08-14 - API sem egress: login Google e integracoes externas

Janela: **2026-08-01 17:40 UTC ate 2026-08-14 16:20 UTC (12 dias, 22 horas e 40
minutos).** Encerrado.

Todos os horarios deste documento estao em UTC, com o horario de Brasilia
(BRT, UTC-3) entre parenteses quando ajuda a cruzar com o relato operacional.
Os timestamps do PostgreSQL e dos logs dos containers sao UTC na origem.

Este incidente e a **reincidencia** do que ja havia sido diagnosticado em
`docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`. Naquele documento a causa foi
identificada corretamente e o plano de correcao foi escrito, incluindo a
declaracao de `gw_priority`. A correcao nao foi aplicada, e o sistema seguiu
mais 11 dias quebrado.

## Resumo

O container `importacao-api` ficou sem rota de saida para a internet. Ele
continuou alcancando banco, Redis, o gateway do bridge, o host e o roteador da
LAN em menos de 1 ms, e continuou respondendo `/health/ready` com HTTP 200 --
porque esse health check so cobre banco e Redis. Para fora, nada passava.

Como o login Google e fail-closed (sem confirmar pertencimento ao Google Group
nenhum JWT local e emitido), toda tentativa de login estourava `ETIMEDOUT` em
`https://oauth2.googleapis.com/token`. O `authController` convertia qualquer
excecao em HTTP 401, e o `api-client` do front tratava qualquer 401 como sessao
expirada. Resultado na tela do usuario: **"Sua sessao expirou. Entre novamente
para continuar de onde parou."** -- em loop, sem nunca revelar o motivo real.

Impacto medido:

- **1.864 execucoes consecutivas do sync SYDLE falharam, com zero sucessos**
  entre 01/08 17:40 e 14/08 16:19.
- Ingestao de e-mail via Gmail API, `pre-cons-drive-sync` e demais chamadas
  Google falhando pelo mesmo motivo.
- Login bloqueado de forma intermitente para toda a operacao. Nas 30 horas de
  log que foi possivel reter antes do container ser recriado, 13 tentativas
  falharam: Franciely (8x), Leticia (3x) e Odett (2x). Em 03/08 o mesmo
  bloqueio atingiu Leticia (6x), Odett (2x) e Eduarda (1x).
- Apenas 6 logins passaram em toda a janela de 13 dias (ver "Vazamento da rota").

Nenhum dado foi perdido ou corrompido. Nao houve bypass de autenticacao ou
autorizacao: o gate falhou fechado, como projetado.

## Linha do tempo completa

| Horario (UTC)                  | BRT         | Evento                                                                                                                                                                                                | Evidencia                                  |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026-07-17 17:00               | 14:00       | Ultimo deploy antes da janela (SHA `b55968a1`). Sync SYDLE roda 144/144 por dia ate 01/08.                                                                                                            | `deploy.log`, `sydle_sync_runs`            |
| 2026-08-01 17:20:00            | 14:20       | Ultima execucao bem-sucedida do sync SYDLE (run 5367).                                                                                                                                                | `sydle_sync_runs`                          |
| 2026-08-01 ~17:2x-17:38        | ~14:2x      | Host reinicia. A execucao das 17:30 nao chega a rodar.                                                                                                                                                | `uptime`                                   |
| 2026-08-01 17:38:22-23         | 14:38       | Containers sobem no mesmo segundo: `importacao-postgres`, `importacao-redis`, `vault-central`, `ia-local-gateway`, `ia-local-ollama`, `n8nprod-n8n`, `lab1085-n8n`, `auditoria-financeira-backend-1`. | `docker inspect .State.StartedAt`          |
| 2026-08-01 17:40:00            | 14:40       | **Primeira falha do sync, 2 minutos apos o boot.** A partir daqui, nunca mais um sucesso.                                                                                                             | `sydle_sync_runs` run seguinte a 5367      |
| 2026-08-02 a 2026-08-13        | --          | 144 falhas por dia, 0 sucessos. Doze dias inteiros. Nenhum alerta disparou.                                                                                                                           | `sydle_sync_runs`                          |
| 2026-08-03 12:16-12:19         | 09:16-09:19 | Leticia, Odett e Eduarda nao conseguem logar. Relato operacional as 09:18 BRT.                                                                                                                        | `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`   |
| 2026-08-03 14:37               | 11:37       | As tres conseguem logar na repeticao.                                                                                                                                                                 | `audit_logs`                               |
| 2026-08-03                     | --          | Causa diagnosticada e documentada, com plano de correcao. **Nada e aplicado.**                                                                                                                        | `docs/STATUS-2026-08-03-LOGIN-GOOGLE.md`   |
| 2026-08-07 13:26-19:10         | 10:26-16:10 | Quatro deploys (`c8f8b86`, `4f15d4c`, `52c03b2`, `b70a60b`). O container e recriado e volta com a mesma rota default quebrada.                                                                        | `deploy.log`                               |
| 2026-08-07 23:45:01            | 20:45       | Primeiro `ETIMEDOUT` para `oauth2.googleapis.com` dentro da janela de log retida.                                                                                                                     | log do container                           |
| 2026-08-11 13:35:24            | 10:35       | Login de Lilian passa.                                                                                                                                                                                | `audit_logs`                               |
| 2026-08-11 19:09:08            | 16:09       | Login de Leticia passa.                                                                                                                                                                               | `audit_logs`                               |
| 2026-08-12 19:00:26            | 16:00       | Login de Lilian passa.                                                                                                                                                                                | `audit_logs`                               |
| 2026-08-13 13:13:57-13:14:06   | 10:13-10:14 | Odett falha 2x.                                                                                                                                                                                       | `Google Groups: error checking membership` |
| 2026-08-13 20:12:50-20:14:35   | 17:12-17:14 | **Franciely falha 4x.**                                                                                                                                                                               | idem                                       |
| 2026-08-13                     | 17:16       | Franciely reporta no WhatsApp: "nao estou conseguindo acessar o sistema".                                                                                                                             | relato                                     |
| 2026-08-13                     | 17:32       | Resposta operacional: "pode tentar agora".                                                                                                                                                            | relato                                     |
| 2026-08-14 10:59:22-11:00:30   | 07:59-08:00 | **Franciely falha mais 4x.**                                                                                                                                                                          | idem                                       |
| 2026-08-14                     | 08:01       | Franciely reporta de novo, com print da tela "Sua sessao expirou".                                                                                                                                    | relato                                     |
| 2026-08-14 13:24:19-13:24:57   | 10:24       | Leticia falha 3x.                                                                                                                                                                                     | idem                                       |
| 2026-08-14 13:28:05 / 13:28:13 | 10:28       | Leticia e Odett entram na repeticao.                                                                                                                                                                  | `audit_logs`                               |
| 2026-08-14 14:12:18            | 11:12       | Lilian entra. Ultimo login antes da correcao.                                                                                                                                                         | `audit_logs`                               |
| 2026-08-14 16:11:39-16:13:48   | 13:11-13:13 | Sondagem comparativa: `importacao-api` 0/12 para 8.8.8.8; container alpine novo no mesmo bridge 12/12.                                                                                                | sondagem                                   |
| 2026-08-14 ~16:17              | ~13:17      | Teste de isolamento: desconectar `ia-local-net` devolve a saida; reconectar (gateway volta a 192.168.208.1) mata de novo.                                                                             | sondagem                                   |
| 2026-08-14 ~16:18              | ~13:18      | Correcao ao vivo: `docker network connect --gw-priority -100`.                                                                                                                                        | --                                         |
| 2026-08-14 16:20:00            | 13:20       | **Primeiro sync SYDLE bem-sucedido em 12d22h** (run 7232: 17 buscados, 15 criados, 2 atualizados, 0 erros).                                                                                           | `sydle_sync_runs`                          |
| 2026-08-14 16:31:16-16:34:15   | 13:31-13:34 | Deploy do SHA `0b5393e`: `gw_priority` no compose + correcoes de codigo. 8/8 etapas OK.                                                                                                               | `deploy.log`                               |
| 2026-08-14 16:33:50            | 13:33       | Container recriado. **Recebe de novo o IP 192.168.208.4**, mas a rota default agora sai por `172.20.0.1`. Egress 5/5.                                                                                 | `docker inspect`, sondagem                 |
| 2026-08-14 16:55:52            | 13:55       | **Franciely faz login com sucesso.**                                                                                                                                                                  | `audit_logs`                               |
| 2026-08-14 17:32:31            | 14:32       | Odett faz login.                                                                                                                                                                                      | `audit_logs`                               |
| 2026-08-14 18:20:00            | 15:20       | Uma falha isolada do sync (`fetch failed`, 533 ms) -- 1 em 33. Em observacao.                                                                                                                         | `sydle_sync_runs` run 7244                 |
| 2026-08-14 21:40:00            | 18:40       | 32 sucessos de sync acumulados desde a correcao.                                                                                                                                                      | `sydle_sync_runs`                          |

## Causa

### O que esta provado

O `importacao-api` participa de duas redes Docker:

- `importacao_default` (172.20.0.0/16): banco, Redis, web, cert-api e egress.
- `ia-local-net` (192.168.208.0/20): acesso ao `ia-local-gateway` da IA on-prem.

A rota default do container estava em `ia-local-net`, via `192.168.208.1`, e
por esse caminho o trafego externo do container morria. O teste que isola isso
foi feito em producao e e reproduzivel:

```
desconectar ia-local-net  -> default via 172.20.0.1 -> ping 8.8.8.8 OK
reconectar ia-local-net   -> default via 192.168.208.1 -> ping 8.8.8.8 FALHA
reconectar com gw-priority -100 -> default via 172.20.0.1 -> ping 8.8.8.8 OK
```

O gatilho foi o **reboot do host em 01/08 as 17:38 UTC**. A primeira falha do
sync veio 2 minutos depois, e nao houve nenhum sucesso desde entao ate a
correcao. Nao houve deploy nosso em 01/08 -- o ultimo antes disso foi em 17/07.

### O que foi descartado com teste

- **Nao e cadastro, papel, dominio ou pertencimento ao grupo.** Franciely
  (`users.id=6`, `analyst`, ativa desde 09/06) nunca gerou registro
  `login_failed` com `not_in_group`. As falhas dela sao excecao de rede, nao
  negativa de autorizacao.
- **Nao e a rede `ia-local-net` em si.** Um container alpine descartavel
  anexado ao mesmo bridge, com o mesmo gateway default, sai para a internet
  12/12. `portal-app` (.8) e `n8nprod-n8n` (.5) tambem tem a default nesse
  bridge e funcionam.
- **Nao e veth ou anexo velho.** O `disconnect` + `connect` de 14/08 criou um
  anexo novo e a falha continuou identica. O deploy de 07/08 tambem recriou o
  container inteiro sem resolver.
- **Nao e subnet sobreposta.** Nenhuma outra rede Docker do host cobre
  192.168.208.0/20, e o host tem exatamente uma rota para essa faixa.
- **Nao e conntrack cheio.** 441 de 262.144 entradas no momento do diagnostico.
- **Nao e MTU, erro de interface ou perda no bridge.** `br-5704d820cb81` com 0
  erros e 0 descartes em RX e TX.
- **Nao e DNS.** A resolucao funcionava; o que falhava era TCP e ICMP para
  qualquer destino externo, inclusive por IP puro.

### O que continua em aberto

**Por que esse caminho falha para este container e nao para os vizinhos do
mesmo bridge.** O IP `192.168.208.4` e a unica constante: o container o recebeu
antes do incidente, manteve depois do reboot, depois do deploy de 07/08 e ate
depois do deploy de 14/08. A hipotese e uma regra de firewall/NAT presa a esse
endereco, no host ou no roteador da LAN.

Nao foi possivel confirmar porque `sudo` no servidor de producao pede senha.
Para fechar, rodar no host:

```bash
sudo iptables -t nat -S POSTROUTING | grep -E '192\.168\.208|172\.20'
sudo iptables -S DOCKER-USER
sudo iptables -S FORWARD | head -30
```

O experimento que decide, se houver janela: liberar o `.4` (desconectar a API
de `ia-local-net`), subir um container descartavel forcado nesse IP
(`docker run --rm --network ia-local-net --ip 192.168.208.4 ...`) e testar a
saida. Se falhar, a regra e por IP. **Isso derruba o acesso a IA local durante
o teste e nao deve ser feito sem janela combinada.**

### Vazamento da rota

Seis logins passaram durante os 13 dias (11/08 13:35, 11/08 19:09, 12/08 19:00,
14/08 13:28 duas vezes, 14/08 14:12), enquanto o sync SYDLE falhou 1.864 vezes
seguidas sem um unico sucesso.

A explicacao mais provavel e que o caminho nao era um bloqueio binario, e sim
uma perda altissima: o cliente Google (`gaxios`) tenta de novo por padrao
(`retry: 3`, `noResponseRetries: 2`) e ocasionalmente atravessa, enquanto o
cliente do SYDLE falha em ~530 ms sem repetir. O documento de 03/08 registrou o
mesmo padrao: falha, sucesso na repeticao horas depois, falha de novo. Isso
tambem explica por que insistir as vezes funcionava -- e por que a Franciely,
que tentou 8 vezes em dois dias, nunca teve sorte.

Essa e uma hipotese consistente com todas as evidencias, mas nao foi
confirmada por medicao de perda; a correcao removeu o caminho antes disso.

## Por que ninguem viu por 13 dias

1. **O health check nao cobre egress.** `/health/ready` valida API, banco e
   Redis. Ficou verde durante todo o incidente, e o deploy de 07/08 passou nos
   8 checks com o sistema quebrado.
2. **1.864 falhas de cron nao geram alerta.** O `sydle-sync` falhou 144 vezes
   por dia, 12 dias seguidos, e isso so apareceu quando alguem foi ler o log.
3. **O erro mentia para o usuario.** Quem tentava logar via "sua sessao
   expirou", que sugere problema de sessao ou senha -- nao de infraestrutura.
   Isso desloca o diagnostico para o lado errado e transforma o usuario em
   unico detector do incidente.
4. **O diagnostico de 03/08 nao virou correcao.** A causa e o plano existiam
   desde o dia 3.

## Correcoes aplicadas

### Infraestrutura -- commit `2d91cfe`

`docker-compose.prod.yml`, servico `api`:

```yaml
networks:
  default:
    gw_priority: 100
  ia-local-net:
    gw_priority: -100
```

A `ia-local-net` continua anexada -- o `ia-local-gateway` esta no mesmo L2 e
segue alcancavel por nome. Apenas a rota default deixa de sair por ela.

Aplicado ao vivo antes do deploy com
`docker network connect --gw-priority -100 --alias importacao-api --alias api ia-local-net importacao-api`.

### Codigo -- commit `0b5393e`

| Arquivo                                 | Mudanca                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/utils/resilience.ts`            | `isNetworkError()` separa "o outro lado disse nao" de "nao consegui falar com o outro lado". Cobre o formato Gaxios, que poe o erro de socket em `err.error` e so preenche `err.response` quando houve resposta HTTP. |
| `shared/errors/index.ts`                | `ServiceUnavailableError` (503) e `ForbiddenError` (403).                                                                                                                                                             |
| `auth/service.ts`                       | `verifyIdToken` tambem busca chaves pela rede: falha de rede vira 503, token adulterado continua 401. Fora do grupo e conta desativada viram 403.                                                                     |
| `auth/controller.ts`                    | Deixa de achatar toda excecao em 401; respeita o `statusCode` do `AppError`.                                                                                                                                          |
| `web/shared/lib/api-client.ts`          | 401 vindo de `/api/auth/login` e `/api/auth/google` nao redireciona mais para `/login?expired=1`. A mensagem real chega ao `LoginPage`.                                                                               |
| `integrations/google-groups.service.ts` | Cache de 10 min no caminho feliz e sobrevida de 12 h usada **so** quando o Google esta inacessivel. Negativas nao entram no cache: incluir alguem no grupo vale na hora, e quem sai perde a sobrevida junto.          |

Cobertura: 16 testes novos, incluindo o formato exato do erro Gaxios deste
incidente. Suite completa em 877 testes de API e 127 de web, lint e typecheck
limpos, build OK.

## Verificacao pos-correcao

- Rota default do container recriado: `default via 172.20.0.1 dev eth1`.
- O container voltou a receber `192.168.208.4` e mesmo assim tem saida -- ou
  seja, sem o `gw_priority` o deploy de 14/08 teria reintroduzido a falha.
- `oauth2.googleapis.com`: alcancavel (HTTP 400 para POST vazio, que e a
  resposta esperada).
- `ia-local-gateway`: resolve e responde.
- Sync SYDLE: 32 sucessos, 1 falha isolada em 33 execucoes.
- Login: Franciely as 16:55:52 e Odett as 17:32:31.
- `APP_VERSION` em producao: `0b5393e967bf9d29bf2e9b9173461d75126e3ba0`.

## Pendencias

Registradas em `docs/KNOWN_ISSUES.md` e `docs/TECH_DEBT.md`:

1. A regra que bloqueia `192.168.208.4` continua desconhecida e ativa. O
   `gw_priority` contorna, nao remove.
2. Nao existe alerta de egress nem de cron falhando em sequencia. Foi o que
   permitiu 13 dias de silencio.
3. A falha isolada do sync as 18:20 tem a mesma assinatura generica
   (`fetch failed`) e merece observacao por alguns dias.
4. O procedimento de diagnostico esta em `docs/RUNBOOK.md`, secao
   "API sem egress externo".

## Licao principal

O diagnostico correto ja existia em 03/08, com o plano de correcao escrito. O
que faltou foi fechar o ciclo: transformar o documento em mudanca aplicada e em
alerta. Um post-mortem que nao vira commit e alerta e so um registro do proximo
incidente.

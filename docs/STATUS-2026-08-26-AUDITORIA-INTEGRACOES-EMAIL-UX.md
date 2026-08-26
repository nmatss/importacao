# Status — Auditoria De Integrações, E-mail, Reprocessamento E UX — 2026-08-26

## Objetivo E Escopo

Sessão de continuação com auditoria e correção autorizada de integrações,
entrada e saída de e-mail, processamento documental, segurança, páginas,
responsividade e operação. A auditoria inicial não fez mutação remota; a
continuação autorizada publicou o release `41d0190` com backup, migrations e
smoke. Nenhum e-mail real nem reprocessamento adicional foi disparado.

## Conclusão Executiva

O ambiente local inicialmente auditado **não estava 100% operacional**. A
continuação autorizada consultou produção em modo read-only e separou o estado
real do host das limitações locais:

- Gmail autentica e pode ser usado como canal primário de leitura;
- IMAP recusou autenticação;
- o código anterior tentava autenticar o relay e recebia `EAUTH`; o release
  implantado omite autenticação para o relay atual e passou em produção, sem
  enviar mensagem;
- a raiz configurada do Google Drive respondeu HTTP 404;
- Odoo e IA local dependem de nomes da rede Compose, mas os containers deste
  projeto não estão em execução;
- Follow-Up Sheets e Certificações não possuem os identificadores/chave
  necessários no ambiente corrente;
- SYDLE está desabilitado e sem configuração completa;
- o Compose de desenvolvimento agora valida sem exigir credenciais de
  integrações opcionais, mas esses serviços continuam inoperantes até receberem
  configuração; o Compose de produção permanece fail-closed.

O probe SMTP usou `transport.verify()`: ele validou conexão/autenticação sem
enviar mensagem. O Google Chat não foi testado porque o único probe real faria
uma publicação externa.

## Matriz De Integrações

| Integração       | Configuração                                 | Probe seguro                                 | Estado observado                              |
| ---------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| Gmail API        | presente                                     | perfil, sem ler mensagens                    | **PASSOU**                                    |
| IMAP             | presente                                     | login/logout                                 | **FALHOU** — autenticação recusada            |
| SMTP             | presente                                     | `verify()`, sem envio                        | **FALHOU** — `EAUTH`                          |
| Google Drive     | credencial e raiz presentes                  | listagem da raiz, sem nomes no relatório     | **FALHOU** — HTTP 404                         |
| Follow-Up Sheets | ID ausente                                   | não aplicável                                | **BLOQUEADO POR CONFIGURAÇÃO**                |
| Odoo             | presente                                     | autenticação read-only                       | **FALHOU** — DNS indisponível fora do Compose |
| SYDLE            | desligado/incompleto                         | não executado                                | **INATIVO**                                   |
| IA local         | provider `ialocal`, egress externo desligado | smoke sanitizado                             | **FALHOU** — gateway local não resolvido      |
| Google Groups    | configuração presente                        | não executado sem identidade real            | **NÃO VALIDADO AO VIVO**                      |
| Google Chat      | webhook presente                             | não executado para não publicar mensagem     | **NÃO VALIDADO AO VIVO**                      |
| Cert-API         | planilha e chave ausentes                    | não iniciado; startup possui efeitos de sync | **BLOQUEADO POR CONFIGURAÇÃO**                |
| SMTP/IMAP E2E    | GreenMail 2.1.13 descartável                 | envio, leitura, PDF, flags e API real        | **PASSOU — SANDBOX LOCAL**                    |

Inferência, confiança alta: a ausência dos containers explica Odoo e IA local,
mas não explica a recusa SMTP/IMAP nem o 404 do Drive; esses três exigem correção
de credencial/permissão/ID.

## E-mail — Diagnóstico E Correções

### Entrada

- `EMAIL_INGESTION_ENABLED=true`, allow-list de remetentes presente e Gmail
  configurado.
- O scheduler só roda dentro da API/worker; nenhum container do projeto estava
  ativo. Configuração presente não prova execução periódica.
- Foi corrigida uma exceção pós-persistência: o processador chamava `.some()`
  no objeto de metadados em vez da lista de anexos. Isso podia transformar um
  e-mail já persistido em `failed`. O helper puro agora distingue formato não
  suportado de duplicata e possui teste de regressão.
- O log da consulta Gmail deixou de persistir remetente/assunto, e o profile
  probe deixou de registrar o endereço da mailbox.
- Foi corrigida a barreira de acknowledgement: um log `processing` recente
  agora mantém a mensagem não lida; uma lease abandonada é reclamada e retomada
  no mesmo log após `EMAIL_PROCESSING_STALE_MINUTES`. Antes, a mera existência
  do log fazia o próximo poll marcar como lido e perder o trabalho interrompido.
- O cliente IMAP passou a ter TLS mínimo 1.2, validação de certificado por
  padrão, timeouts e limites de linha/literal. A exceção para certificado
  self-signed existe somente por opt-in e foi usada no contêiner E2E.

### Saída

- A tela salvava `smtp_host`, `smtp_port` e `smtp_user`, mas o transporte usava
  somente o ambiente. O transporte agora resolve banco com fallback para env;
  `SMTP_PASS` continua exclusivamente em env/SOPS.
- A rota administrativa `POST /api/settings/smtp/test` possui rate limit,
  mensagens sanitizadas e nunca chama `sendMail`.
- O `From` agora aceita exatamente uma mailbox, rejeitando CR/LF, lista e
  sintaxe de grupo antes do Nodemailer. Porta e usuário também são validados.
- A caixa `global@grupounico.com` permanece explicitamente em `Cc`, mesmo sendo
  remetente, alinhando header, regra operacional e auditoria persistida.

Diagnóstico atualizado: o relay atual não exige autenticação, mas o código
implantado tentava usar o usuário placeholder e recebia `EAUTH`. A lógica deste
release passou em `transport.verify()` dentro do contêiner de produção sem
enviar mensagem. Um disparo real continua pendente de destinatário controlado,
pois `verify()` comprova conexão/handshake, não entrega fim a fim.

Evidência isolada: o E2E com GreenMail enviou uma mensagem externa com PDF,
leu-a por IMAPS, marcou-a como lida, criou um rascunho pela API, sanitizou o
HTML, enviou-o pelo transporte da aplicação e confirmou o recebimento. Isso
prova o caminho de código, não a credencial do provider real.

## Documentos E Reprocessamento

Fatos de ambientes distintos não devem ser misturados:

- checkpoint de validação de 2026-08-25: 117 processos oficiais, 51 documentos
  em 12 processos, todos processados; seis alvos reprocessados com sucesso, um
  packing list a 86,63% ainda em revisão humana;
- os outros 105 processos não possuíam arquivo local, então não existe
  reprocessamento documental possível para eles;
- banco local corrente: 1.375 processos, zero documento e 20 logs de e-mail
  `ignored`; as tabelas novas de telemetria de extração não estão migradas;
- na continuação autorizada, produção foi consultada somente por agregados:
  117 processos, 51 documentos, zero documento não processado, zero lease
  ativa, zero par inválido de frete e zero estado de correção inválido. Isso
  confirma que o checkpoint de reprocessamento continua íntegro no host em
  2026-08-26, sem afirmar acurácia contra ground truth.

Decisão: nenhum replay adicional foi disparado. O estado anterior prova que os
documentos existentes no ambiente de validação chegaram a estado terminal, não
que “todos os processos” possuam documentos nem que produção esteja igual.

## UX, UI, Layout E Responsividade

A skill Playwright foi usada contra Vite local com identidade e respostas
simuladas, sem dados reais. Foram exercitadas 31 variantes de rota em 1440x900 e
390x844, cobrindo login, portal, 20 páginas/variantes de importação e nove de
certificações. Também foram alternadas as cinco abas de Configurações e as 13
abas do detalhe de processo.

Resultados:

- 31/31 rotas renderizaram sem Error Boundary ou exceção de página após os
  contratos simulados serem ajustados ao formato real;
- nenhuma rota ultrapassou o viewport após as correções;
- botões sem nome acessível: zero; imagens sem `alt`: zero;
- não houve alvo interativo visível abaixo de 24x24 px; a barra de abas longa
  mantém scroll horizontal intencional;
- detalhe de processo tinha 16 px totais de overflow por margem negativa
  incompatível com o padding do shell; corrigido;
- o par de datas da Pré-Conferência era cortado no celular; corrigido para grade
  responsiva de uma coluna.

As screenshots derivadas estão em `output/playwright/` e foram ignoradas pelo
Git. Elas usam somente dados simulados.

Limitação: este smoke comprova renderização, navegação, responsividade e estados
vazios. Ações mutáveis de negócio, dados reais, downloads, upload, envio, sync e
permissões externas ainda dependem de um ambiente integrado e de fixtures E2E.

Complemento retomável: `playwright.config.ts` e
`apps/web/e2e/email-workflows.spec.ts` passaram em Chromium desktop e Pixel 7.
Os quatro cenários versionados cobrem composição, payload, confirmação,
focus-trap/Escape/restore focus, save SMTP, `verify()` sem envio, erros de
console e overflow. O envio do browser é interceptado; o envio SMTP real fica no
GreenMail da suíte da API.

## Segurança

- **ALTO, corrigido:** injeção/reinterpretação do envelope `From`.
- **ALTO, corrigido:** versões vulneráveis de `mailparser`/`undici` no caminho
  de e-mail não confiável; patches compatíveis aplicados.
- **MÉDIO, corrigido:** query string e conteúdo de e-mail/documento podiam entrar
  nos logs; logger e request logging foram redigidos.
- **MÉDIO, corrigido:** HTML de comunicação era filtrado por regex; agora usa
  `sanitize-html` com allow-list de tags, atributos, esquemas e CSS.
- **ALTO, corrigido:** crash após criar o log `processing` podia fazer o poll
  seguinte reconhecer a existência do log e marcar a mensagem como lida sem
  concluir; o claim/lease agora preserva o acknowledgement.
- **BAIXO, corrigido:** erro interno do coletor Prometheus era devolvido como
  texto ao cliente autorizado; resposta agora é genérica.
- **MÉDIO, residual:** JWT em `localStorage`, risco aceito no ADR 0003 e
  dependente de prevenção rigorosa de XSS.
- **MÉDIO, corrigido na continuação de 26/08:** React Router foi migrado para
  7.18.2 e o loader abandonado do Drizzle foi substituído por `tsx`. Instalação
  limpa, audit completo/runtime, CLI do Drizzle e regressão de rotas passaram
  com zero vulnerabilidades npm.

Relatório detalhado: `docs/SECURITY_AUDIT_2026-08-26.md`.

## Alterações Principais

- correção do desfecho de anexos na ingestão;
- configuração SMTP efetiva, validação de remetente e probe sem envio;
- cópia operacional obrigatória alinhada ao header real;
- patches compatíveis de runtime e upgrade validado do Testcontainers 11→12;
- redução de PII em logs;
- duas correções de overflow responsivo;
- testes unitários e de rota para os novos contratos;
- harness E2E atualizado para aplicar as migrations manuais `0019–0025`. Sem
  isso, o banco descartável ficava atrás do schema e quatro endpoints retornavam
  `400` por colunas/tabelas ausentes.
- GreenMail/Testcontainers versionados para prova SMTP/IMAPS sem egress;
- validação Zod de IDs, paginação, datas e payload de envio de comunicações;
- Compose local desacoplado das credenciais opcionais da Cert-API, mantendo
  produção estrita.

## Validação E Estado De Retomada

Gate final executado:

- `npm run lint`: passou;
- `npm run typecheck`: passou;
- `npm test`: passou — API 109 arquivos, um ignorado; 977 testes, um ignorado;
  web 24 arquivos e 131 testes;
- `npm run test:e2e -w apps/api`: inicialmente 4/44 falharam pela defasagem das
  migrations do banco descartável; após corrigir o harness e adicionar o
  round-trip de e-mail, 6 arquivos e 48/48 testes passaram;
- `npm run test:e2e:web`: 4/4 passaram em Chromium desktop/mobile;
- `ruff check apps/cert-api`: passou;
- `pytest -q apps/cert-api/tests`: 509 testes passaram;
- `npm run build`: passou; permanece o warning conhecido do chunk
  `ProcessDetailPage` com 514,61 kB;
- `npm audit`: zero alto/crítico, seis moderados totais e dois no runtime;
- `pip-audit -r apps/cert-api/requirements.txt`: nenhuma vulnerabilidade
  conhecida;
- `git diff --check`: passou;
- `npm run format:check`: falhou nos mesmos 19 arquivos preexistentes do
  baseline. O único arquivo da lista tocado nesta sessão foi formatado antes da
  repetição do gate.

Continuação de release em 2026-08-26:

- produção pré-deploy saudável: API, web e proxy HTTP 200; containers críticos
  healthy; 540 GB livres; backup histórico com 1,2 GB; SOPS/age e rede
  `ia-local-net` disponíveis;
- Gmail é o canal primário de leitura e houve ingestão até
  `2026-08-26T09:39:07Z`; 222 logs chegaram a `completed`, 650 a `ignored` e
  nenhum ficou em `processing`;
- IMAP continua recusando autenticação e permanece apenas como fallback
  indisponível;
- `scripts/apply-pending-migrations.sh` foi corrigido para incluir a migration
  idempotente `0025_ai_usage_telemetry.sql`, já presente em produção;
- o usuário autorizou seguir pelos gates de release até o deploy. O rollout
  SYDLE já estava live e foi preservado pelo gate
  `ALLOW_SYDLE_SYNC_DEPLOY=1`.

Deploy concluído em 2026-08-26:

- commit `41d0190bfdedc563c9b741cf46ac142e51264b9f` publicado em `master` e
  gravado em `/home/nicolas/importacao/REVISION`;
- backup `importacao_2026-08-26_115053.pgdump` criado e validado por
  `pg_restore --list`; uploads e volumes de certificados arquivados;
- migrations `0011–0025`, Compose, API, cert-api, web, proxy `/api` e HTTPS
  público passaram; API/web ficaram sem linha de erro desde o restart;
- smoke implantado: SMTP `pass`, Gmail `pass`, IMAP `fail`, Drive `404`;
- pós-deploy: 117 processos, 51 documentos, zero documento não processado,
  zero lease e zero e-mail em `processing`;
- caches e screenshots locais copiados pelo rsync foram removidos do host; o
  script ganhou exclusões explícitas para impedir recorrência.

Próximos gates operacionais:

1. realizar envio controlado quando houver destinatário operacional aprovado;
2. corrigir IMAP e a raiz/permissão do Drive;
3. revisar humanamente o packing list abaixo de 90%.

## Complemento — Revisão Página A Página E Estado Real — 2026-08-26

### Fatos Observados

- inventário atual: 30 rotas funcionais autenticadas, além de login, redirects
  legados e páginas de rota inválida;
- Playwright CLI com API sintética e sem efeitos externos passou em **60/60**
  combinações: 30 rotas em 1440x900 e 390x844;
- em todas as 60 combinações houve HTTP 200, conteúdo principal, ausência de
  Error Boundary, erro de página/console, overflow global, imagem sem `alt` ou
  botão visível sem nome acessível após as correções;
- as cinco abas de Configurações passaram nos dois viewports (**10/10**);
- as 15 variantes do detalhe do processo passaram, incluindo as 13 abas
  centrais e os deep links condicionais de Espelho e Câmbios;
- foram corrigidos quatro botões de seta sem nome acessível no mobile e o botão
  de fechamento do seletor de status logístico;
- foi corrigida uma corrida real: a validação de aba escondida acontecia antes
  de processo/câmbios carregarem e descartava `?tab=espelho`/`?tab=cambios`.

Screenshots sintéticas da rodada estão em
`output/playwright/page-audit-2026-08-26/` e permanecem ignoradas pelo Git.

### Produção — Read-only

- `/home/nicolas/importacao/REVISION` estava em `88f0b72` antes deste candidato;
- API, web, proxy, HTTPS público, PostgreSQL, Redis e Cert-API estavam
  saudáveis; Prometheus/Grafana/Alertmanager também estavam ativos;
- banco: 117 processos, 51 documentos, zero não processado, zero lease ativa,
  zero `aiParsedData` ausente e zero marcador de erro de extração;
- e-mail: 222 logs `completed`, zero `processing` e zero `failed`;
- 41/51 documentos possuem confiança abaixo de 90%: invoice 4/11,
  packing list 9/9, OHBL 7/7, draft BL 5/5 e `other` 16/16; espelho 0/3.

### Decisão E Limites

Estado terminal não prova acurácia. Não foi disparado replay cego em produção:
`other` não possui extrator e reprocessar documentos de baixa confiança sem
ground truth pode consumir orçamento e substituir evidência útil por saída
pior. A afirmação correta é: **todos os documentos existentes estão
processados, mas a qualidade de todos não está certificada**.

Também permanece incorreto afirmar que o envio real está 100% provado. O
caminho completo passou no GreenMail e o relay real passou em `verify()`, mas
nenhuma mensagem externa foi enviada sem destinatário controlado aprovado.
Gmail continua operacional; fallback IMAP e raiz do Drive continuam pendentes.

### Gate Da Correção

- `npm run lint`: passou;
- `npm run typecheck`: passou após completar o fixture tipado do novo teste;
- `npm test`: API 977 + 1 skip; web 135/135;
- `npm run build`: passou, mantendo apenas o warning conhecido do chunk de
  detalhe do processo (514,95 kB);
- `npm run test:e2e:web`: 4/4 passou após isolar os navegadores; uma primeira
  execução concorrente teve flake de foco no desktop, não reproduzido na
  repetição isolada nem na suíte completa final;
- `npm audit --audit-level=high`: passou, com seis moderados conhecidos;
- `docker compose config --quiet` e `git diff --check`: passaram;
- `npm run format:check`: continua falhando nos mesmos 19 arquivos do baseline;
  nenhum arquivo desta correção está na lista.

## Complemento — Fechamento Operacional E Qualidade — 2026-08-26

### Estado Atual Das Integrações

| Integração    | Evidência sanitizada                             | Estado                                           |
| ------------- | ------------------------------------------------ | ------------------------------------------------ |
| Gmail         | `getProfile`, scheduler ativo e logs terminais   | **PASSOU**                                       |
| SMTP          | `transport.verify()`, sem mensagem               | **PASSOU**                                       |
| IMAP          | login/logout                                     | **FALHOU**; fallback indisponível                |
| Drive         | acesso read-only da raiz                         | **FALHOU**; 404/inacessível                      |
| SYDLE         | três runs mais recentes, 2 updates e 0 erro cada | **PASSOU**                                       |
| Cert-API      | health interno, banco e Sheets                   | **PASSOU**                                       |
| Odoo          | autenticação read-only                           | **FALHOU**; DNS `ENOTFOUND`                      |
| Google Groups | configuração obrigatória presente                | **CONFIGURADO**; sem identidade real de teste    |
| Google Chat   | URL válida, nenhuma publicação nesta rodada      | **NÃO PROVADO AO VIVO**                          |
| IA            | Vertex ativo; documentos recentes processados    | **EVIDÊNCIA HISTÓRICA**; smoke pago não repetido |

O probe IMAP expôs e levou à correção de um risco separado da credencial: um
evento `error` tardio do socket podia derrubar o processo Node. O novo smoke
sanitizado é retomável, não lê conteúdo nem dispara mensagens e encerra
explicitamente depois do resumo para não reter o processo pelo pool compartilhado.

### Qualidade E Performance

- `format:check` passou após normalização mecânica do baseline de 19 arquivos;
- relatórios runtime da Cert-API foram retirados do escopo do Prettier;
- o build web agora força `NODE_ENV=production`; `ProcessDetailPage` mede
  246,60 kB no artefato real e o warning anterior de ~515 kB desapareceu;
- nenhuma mudança de banco ou migration foi necessária.

### Gate Atualizado

- lint e typecheck: passaram;
- unitários: API 981 + 1 skip; web 135;
- integração: API E2E 48/48; Playwright 4/4 desktop/mobile;
- Cert-API: Ruff, 509 testes e `pip-audit` passaram;
- build, `format:check`, `git diff --check` e audit alto/crítico passaram;
- seis advisories npm moderados permanecem aceitos/documentados;
- Compose local passou; Compose produtivo local falhou fechado sem secret, e a
  configuração real deve ser revalidada no host via SOPS durante o deploy.

### Bloqueios Que Não Podem Ser Corrigidos Pelo Código

- credencial/app password IMAP;
- ID/compartilhamento da raiz do Drive;
- DNS/hostname do Odoo;
- webhook/chave do Google Chat e destinatário controlado para prova real;
- conferência humana/ground truth dos documentos de baixa confiança.

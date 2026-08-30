# Status 2026-08-29 — Auditoria integral e correcao de filtros, dados, seguranca e UX

## Objetivo

Deixar o sistema funcional e pronto para uso do operador: concluir as paginas,
fazer os filtros funcionarem de fato, corrigir defeitos que alteram dado
aduaneiro, fechar lacunas de autorizacao e melhorar UX/UI — sem inventar
funcionalidade nova e sem alterar contratos publicos desnecessariamente.

## Baseline medido antes de qualquer alteracao

Commit `4f7a991`, master limpa e sincronizada:

```text
npm run typecheck        -> exit 0
npm run lint             -> exit 0
npm test                 -> API 1005 passed + 1 skipped; web 146 passed; exit 0
npm run build            -> exit 0
npm run test:e2e:web     -> 82/82 passed
npm audit --omit=dev     -> 0 vulnerabilidades
```

**Todos os gates estavam verdes.** Nenhum dos defeitos descritos abaixo era
visivel por lint, typecheck, teste ou build. Isso e o achado transversal mais
importante desta sessao: a suite congelava o comportamento existente, nao o
comportamento correto.

## Metodo

Duas fases, com particao de arquivos para evitar edicao concorrente.

1. **Auditoria** — oito agentes em modo somente leitura, um por area:
   paginas centrais de Importacao; paginas operacionais; paginas
   administrativas e shell; Certificacoes; pipeline de ingestao e leitura de
   arquivos; apuracao, validacao e comparativo; e-mail e Google Drive;
   integracoes externas e seguranca.
2. **Correcao** — sete agentes em conjuntos de arquivos DISJUNTOS, mais os
   arquivos que o orquestrador assumiu diretamente.

Regra aplicada a todo achado: evidencia `arquivo:linha`, separacao explicita
entre fato observado e inferencia, e verificacao na releitura antes de
corrigir. Achados que nao se sustentaram estao registrados como refutados na
secao final — nao foram "corrigidos".

## Defeitos provados por execucao, nao por leitura

Estes sete foram reproduzidos rodando o codigo, nao apenas lendo:

### 1. Agendamento semanal disparava um dia depois (BLOQUEADOR)

No APScheduler 3.x, `day_of_week` numerico e 0=segunda; a convencao crontab
que a interface usa e 0=domingo. Execucao com a biblioteca instalada:

```text
CronTrigger(minute='0', hour='6', day_of_week='1') -> 2026-09-01 (TERCA)
CronTrigger(minute='0', hour='6', day_of_week='5') -> 2026-09-05 (SABADO)
CronTrigger.from_crontab('0 6 * * 1')              -> 2026-09-01 (TERCA)
```

O preset "Semanal (Segunda)" gera `0 6 * * 1` e rodava na terca; "Semanal
(Sexta)" rodava no sabado. `from_crontab` tambem nao converte — os dois
caminhos estavam errados. A tela exibia o dia errado junto.

### 2. Filtros de Orgao e periodo do LI nao faziam nada (ALTO)

`validate(schema, 'query')` SUBSTITUI `req.query` pelo resultado do Zod, e
`z.object()` descarta chave desconhecida. `liTrackingQuerySchema` declarava
apenas `page`, `limit`, `status` e `processCode`. Prova de execucao com o Zod
do repositorio: entrada `{page, limit, orgao, startDate, endDate}` produzia
saida `{page: 1, limit: 20}`. O controller e o service tinham o codigo
completo desses tres filtros, inalcancavel. O operador selecionava o orgao,
via o spinner e recebia a mesma lista.

### 3. Filtro de um unico dia na Auditoria retornava zero (ALTO)

`audit/service.ts` usava `gte(created_at, X)` e `lte(created_at, X)` sem o
"+1 dia" que os outros modulos aplicavam. Filtrar de 29/08 ate 29/08 produzia
um intervalo de duracao zero.

### 4. Toda janela de data estava tres horas deslocada (ALTO)

Os containers de API e Postgres rodam em UTC — nenhum `TZ` em
`docker-compose.yml`, `docker-compose.prod.yml` ou `apps/api/Dockerfile` — e as
colunas filtradas sao `timestamp` sem time zone. O operador escolhe a data num
calendario brasileiro e a tela exibe o valor ja convertido para o fuso local.
Tratar 'YYYY-MM-DD' como meia-noite UTC desloca a janela:

- meia-noite local = `03:00Z` (verificado por teste);
- um registro exibido como "29/08 22:00" tem `created_at` em
  `2026-08-30 01:00` UTC e ficava FORA do filtro "29/08".

Sete modulos afetados: processes, communications, email-ingestion, follow-up,
li-tracking, alerts e audit.

### 5. Drive-only entregaria zero documentos (CRITICO, nao registrado antes)

A pasta operacional esta em Shared Drive. A API v3 do Drive exige
`supportsAllDrives` em qualquer requisicao que toque item de shared drive.
Das 13 chamadas em `google-drive.service.ts`, apenas as 4 de listagem tinham a
flag; o **download de conteudo** e as 7 escritas/movimentacoes nao tinham.

Efeito da virada de `DOCUMENT_SOURCE` para `drive` sem essa correcao: o sweep
LISTA os arquivos com sucesso e falha 100% dos downloads com 404, cada falha
caindo num `catch` que conta como `failed` sem alerta. Como o modo Drive-only
tambem desliga a ingestao por e-mail e bloqueia o upload manual, o resultado
seria nenhuma via de entrada documental funcional.

### 6. "LI Urgente" contava toda LI em aberto (ALTO)

O comentario dizia "liDeadline is approaching or passed", mas o WHERE exigia
apenas `hasLiItems`, status aberto e `liDeadline NOT NULL`. Um prazo daqui a
seis meses entrava no cartao de urgencia do painel de SLA e no "prazo critico"
do Meu Dia.

### 7. Entrada invalida devolvia mensagem interna em ingles (MEDIO)

`processes`, `alerts` e `follow-up` aceitavam `startDate`/`endDate` como string
livre. `new Date('abc').toISOString()` lanca `RangeError` (provado por
execucao); o try/catch do controller transformava isso em HTTP 400 com a
mensagem `Invalid time value`.

## Correcoes aplicadas

### Filtros e limites de data

- `liTrackingQuerySchema` recebeu `orgao`, `startDate` e `endDate`.
- Novos helpers em `shared/utils/dates.ts`: `isCalendarDate`,
  `localDayStartUtc`, `localDayEndExclusiveUtc`, `localTodayIso` e
  `localMonthStartUtc`, com 12 testes que congelam as bordas.
- Os sete modulos passaram a delimitar o DIA LOCAL, sempre passando string ISO
  na tag `sql` (nunca objeto `Date`, que seria serializado com o offset do
  processo e voltaria a depender do `TZ` do container).
- `isoDateSchema` compartilhado; `alertsQuerySchema` e `followUpQuerySchema`
  novos, cobrindo TODOS os parametros que seus controllers ja liam.
- Paginacao com desempate estavel por `id` em processes e li-tracking.
- `dashboard/routes.ts`: removida a validacao de periodo que era descartada
  pelo controller. O recorte por periodo NAO foi implementado — seria escopo
  novo. Ver pendencia P-07.
- `allSenders`: parametro aceito por dois schemas e nunca lido, removido.
- Filtro por `status` adicionado a listagem de logs de e-mail.
- Recorte mensal do dashboard e do executivo passou a usar o mes LOCAL;
  `pendingPayments` deixou de incluir processos cancelados.
- `liUrgent` ganhou janela de urgencia (`LI_URGENT_WINDOW_DAYS = 15`).
  **Parametro de negocio a confirmar com o time fiscal.**

### Integridade de dado

- `PUT /api/processes/:id` nao muda mais status: `status` saiu do
  `updateProcessSchema`. Antes um PUT levava um processo de `draft` a
  `completed` num salto, sem `assertTransition` e sem gravar o evento
  `status_changed` — a trilha registrava apenas "update".
- `updateProcessSchema` passou a aceitar `null` explicito em 25 campos, com o
  contrato: **chave ausente = nao mexe; chave com `null` = apaga**. Antes o
  operador nao conseguia limpar NENHUM campo: o valor esvaziado era descartado,
  o backend respondia 200 e a tela dizia "Processo atualizado com sucesso"
  enquanto o dado errado continuava la.
- `parseDate` rejeita mes/dia fora de faixa por verificacao de round-trip.
  Antes `'03/15/2026'` virava 2027-03-03 e `'32/01/2026'` virava 2026-02-01 —
  datas plausiveis e erradas, comparadas como se fossem reais.
- Os dois parsers de data divergentes foram unificados. `date-sequence-check`
  usava `new Date(value)` (MM/DD do JS) enquanto `date-compare` usava DMY: a
  mesma string `'03/04/2026'` produzia duas datas no mesmo run, e a inversao
  cronologica resultante era classificada como falha dura.
- Sentinela `01/01/1900` passou a ser tratada como nula tambem no lado Node,
  alinhando com a regra que so existia na cert-api.
- Espelho: campo nao lido nao vira mais "Free Of Charge", e zero legitimo nao
  vira mais `null`. As duas inversoes propagavam para
  `importProcesses.hasFreeOfCharge`, que e declaracao aduaneira.
- `autoPopulateItems` ganhou ordenacao deterministica e gate de confianca
  operacional. Ver pendencia P-01 para o que falta da ADR 0006.
- `reclassify` passou a respeitar a lease de extracao.
- A reconciliacao arquiva o payload original antes de sobrescrever
  `aiParsedData`.
- Espelho com zero itens deixou de sair com confianca 0,99.
- As protecoes de planilha (linhas em branco, linha so-separador, teto de
  caracteres) foram unificadas num helper unico e aplicadas aos cinco caminhos
  que faziam `sheet_to_csv` cru — antes so um deles estava protegido.
- Pre-Cons: guard de plausibilidade do full refresh. O sync e um DELETE de tudo
  seguido de INSERT, e o unico guard era `rows.length === 0` — uma planilha
  truncada apagava a base inteira e ficava com o que sobrou. E a mesma classe
  do incidente ja resolvido do estoque de certificacao.
- Pre-Cons: `'0.00'` e string truthy, entao o guard antigo deixava passar FOB
  zero e `diff / 0` classificava TODA divergencia como critica.
- Cambio: cronograma incompleto (percentuais que nao somam 100) deixou de ser
  silencioso e passa a gerar alerta.

### Seguranca e autorizacao

- Admin nao consegue mais se auto-desativar nem se rebaixar, e o ultimo admin
  ativo esta protegido. Antes isso derrubava o acesso na requisicao seguinte e,
  no caso do ultimo admin, so SQL direto recuperava.
- Metricas Prometheus passaram a rotular pela rota REGISTRADA. Antes, um path
  desconhecido criava uma serie nova por valor, sem autenticacao e inclusive em
  404 — 25 paths desconhecidos agora produzem uma serie, nao 25.
- Google OAuth exige `email_verified`. O claim `hd`, quando presente, tem que
  bater com `ALLOWED_DOMAIN`. Ver a nota de risco em P-12.
- `audit_logs` passou a registrar ator e IP na criacao, alteracao e
  desativacao de usuario — antes uma escalacao de privilegio ficava registrada
  como acao anonima.
- Escrita de modelos de comunicacao virou admin-only. Antes qualquer analista
  reescrevia o modelo que outra pessoa usa para escrever a KIOM/Fenicia/ISA.
- Regexes de leitura do proxy da cert-api passaram a recusar `%`, fechando a
  falha latente de traversal percent-encoded.
- `userEmail` entrou na lista de redacao do logger.
- Controllers de auth e settings pararam de devolver mensagem interna ao
  cliente, preservando as mensagens de produto.
- `jwt.verify` com algoritmo fixado; token de `/metrics` comparado em tempo
  constante; Sentry com `beforeSend` e `sendDefaultPii: false`.
- Fila `email-send` REMOVIDA: caminho morto, sem nenhum enfileirador em todo o
  repositorio, que enviava e-mail sem a allow-list de destinatario e sem a
  sanitizacao de HTML aplicadas por `communicationService.send()`.

### Frontend e UX

- `ProcessEditPage` passou a invalidar o cache: antes a tela de detalhe
  renderizava o valor pre-edicao por ate 30 segundos, logo depois de um toast
  verde dizendo que salvou.
- Filtros da lista de processos migraram para a URL, o que tambem conserta os
  links do Meu Dia, que passavam `?status=` para uma tela que ignorava o
  parametro.
- `PreConsTab` parou de exibir o badge verde "Sem divergencias" quando a
  resposta era 403 — ausencia de autorizacao apresentada como ausencia de
  problema.
- `ComunicacoesTab` e tres queries do dashboard pararam de transformar falha de
  carga em estado vazio.
- Checklist e Follow-Up passaram a compartilhar a mesma query key e a invalidar
  em cascata.
- Auditoria virou admin-only tambem no menu e na rota; os botoes admin-only da
  Ingestao de E-mail deixaram de aparecer para o analista.
- Historico de Atendimentos ganhou paginacao — a partir do item 101 ele era
  invisivel de forma permanente.
- Alertas passaram a mostrar se foram entregues. Isso e diretamente relevante
  ao incidente registrado de 6.349 alertas com zero entregas.
- Foco inicial do visualizador de documentos saiu do botao "Baixar".
- Dark mode corrigido nos mapas de severidade e nos graficos.
- Acentuacao, titulos duplicados e alvos de toque normalizados.

### cert-api

- Traducao crontab -> APScheduler no dia da semana, com o mesmo caminho usado
  na validacao e no disparo, de modo que "aceito na criacao" e "dispara no dia
  certo" nao possam mais divergir.
- `/api/stats` parou de engolir excecao e devolver zeros — uma queda do
  PostgreSQL renderizava um sistema saudavel e vazio.
- "Nao Encontrado" deixou de incluir produto nunca validado; bucket
  `never_validated` acrescentado ao payload.
- Execucao manual deixou de gravar historico eternamente em `running`, e o
  historico deixou de gravar `completed` para run que quebrou.
- "Proxima execucao" passou a ser recalculada apos cada disparo.
- Filtro de periodo deixou de esconder agendamento nunca executado.
- Os dois eixos de status pararam de se contradizer na mesma linha.
- Derivacao passou a usar o dia no fuso de Sao Paulo.

## Segunda rodada — fechamento do backlog

A primeira rodada corrigiu o que impedia o uso e registrou 26 pendencias. A
segunda atacou as que eram corrigiveis sem decisao de negocio.

### O defeito que a segunda rodada encontrou antes de comecar

**CRITICO — duas implementacoes divergentes do mesmo passo de migration, e a que
os testes exercitam nao era a que roda em producao.**

`shared/database/migrate.ts` enumerava as migrations forward-only numa lista
ESCRITA A MAO que parava na `0024`. As migrations `0025_ai_usage_telemetry.sql` e
`0026_document_ingestion_source.sql` existiam no disco e **nunca eram aplicadas
por esse runner**. A `0026` cria `documents.ingestion_source`, coluna de que
depende todo o contrato de entrada Drive-only entregue em 2026-08-28 — e de que
depende tambem a correcao de deduplicacao do Drive feita nesta sessao.

O defeito era invisivel para a suite porque `test/e2e/setup.ts` descobria os
arquivos com `readdirSync`: o E2E aplicava as duas e passava verde (48/48),
enquanto o caminho de producao as pulava em silencio.

Correcao: `shared/database/pending-migrations.ts`, fonte unica consumida pelos
dois lados. Sete testes comparam a descoberta com o CONTEUDO DO DISCO, entao uma
migration nova entra sozinha e uma lista escrita a mao volta a falhar. Um deles
verifica tambem que toda migration forward-only e idempotente — o runner
reaplica todas a cada deploy, e uma sem guarda quebraria o SEGUNDO deploy
enquanto o primeiro passava. Provado por mutacao: reintroduzir o corte na 0024
derruba dois testes.

### Corrigido na segunda rodada

**Canal de alerta (P-15) — a causa era codigo, nao credencial.**
A deduplicacao devolvia o alerta duplicado antes de tentar entregar;
`sent_to_chat = false` nao era lido por nenhum job; e o cooldown do circuit
breaker descartava em silencio. Agora: duplicado nao entregue tenta de novo;
job de reentrega a cada 5 minutos com backoff (5/10/20/40/80 min), teto de 5
tentativas e janela de 24h; cooldown e webhook ausente registram o motivo sem
consumir tentativa e sem marcar como entregue; regra `AlertDeliveryFailing` no
Prometheus sobre a metrica que ja existia e sobre a qual nada alertava; e
`/health/integrations` passou a resolver o webhook pela MESMA funcao que a
entrega usa — antes o health lia o env e o envio lia o banco, entao o health
podia estar verde com o canal morto. `POST /api/alerts`, que publica no espaco
corporativo do Chat, virou admin-only com rate limit.

**Rate limiter nao era atomico.** `cache.get` -> `JSON.parse` -> `cache.set`, sem
nada de atomico entre a leitura e a escrita: uma rajada concorrente lia o MESMO
contador e escrevia o mesmo valor, e o limite de 5 tentativas por janela do login
era ultrapassado com folga. Agora ha `cache.incr` atomico (INCR no Redis,
contador sincrono no fallback em memoria), com janela FIXA — so o primeiro
incremento define o TTL, senao a janela nunca fecharia. A chave passou a usar o
caminho completo, e nao o `req.path` relativo do Router, que faria duas rotas
homonimas de modulos diferentes compartilharem balde.

**Injecao de prompt no assistente operacional.** O corpo de comunicacoes e o
assunto/remetente de e-mails recebidos entravam no prompt sem delimitador e sem
instrucao de ignorar comandos embutidos — um remetente externo que escreve para
a caixa compartilhada controlava texto que o modelo lia como contexto. Agora cada
fonte entra delimitada, o system prompt declara que o conteudo entre marcadores e
DADO e nunca instrucao, e o conteudo e neutralizado antes de entrar: sem isso a
defesa seria decorativa, bastando o remetente escrever o proprio marcador de
fechamento para "sair" do bloco. Fonte de origem externa tambem e cortada mais
curto. Provado por mutacao.

**SYDLE: sucesso vazio nao era anunciado.** Falha dura ja gerava alerta critico
via `handleCronError`; a lacuna era o run que termina com `status: 'success'` e
`fetched: 0` — sintoma de contrato alterado do lado do SYDLE. A tela financeira
congelava nos dados antigos sem sinal. Agora um run que traz zero logo depois de
um run com registros gera alerta, e registro que chega sem identificador
utilizavel e contado e anunciado separadamente.

**`PUT /api/settings/:key` aceitava qualquer chave e qualquer valor.**
`smtp_from` gravado por ali escapava do `isValidMailFrom`: o envio falhava
fechado depois com 503, longe da tela onde o admin digitou o valor errado.
Agora ha allow-list, e chave coberta por rota dedicada e recusada apontando a
rota que valida.

**`x-correlation-id` era aceito cru**, ia para todas as linhas de log e voltava
no header — um valor com quebra de linha fazia `res.setHeader` lancar e virava 500. Agora exige `^[\w-]{1,64}$` e gera um proprio quando o valor nao serve.

**Politica de retry das filas era o default implicito da biblioteca.** Agora e
declarada. Dead-letter continua ausente e registrada como pendencia — e o mesmo
padrao do alerta que morria no banco, e exige decidir onde a fila morta e
observada antes de criar.

**Resolucao do webhook do Chat estava duplicada em quatro pontos**, e uma das
copias fazia `setting?.value as string`, que quebra quando o valor esta gravado
no formato objeto. Unificadas na funcao unica.

**Infra.** O `proxy_pass` com hostname literal em `infra/nginx/prod.conf` — o
padrao que causou o 502 de 2026-06-22, reaberto em 2026-07-16 — foi corrigido, e
a correcao foi validada reproduzindo o incidente: recriando o container da API
com IP novo, o config antigo passa de 200 para 502 e o corrigido continua em 200.
`TZ` foi acrescentado ao servico da cert-api e DELIBERADAMENTE nao ao `api` nem
ao `postgres`: `formatDate` usa hora local do processo e o driver serializa
`Date` em hora local ao gravar coluna `timestamp` sem tz, entao a API passaria a
gravar relogio de Sao Paulo em colunas cujas linhas existentes sao UTC —
corrupcao silenciosa que nenhum teste pegaria. `cert_stock.synced_at` foi
migrada para `TIMESTAMPTZ` com conversao condicional e idempotente, validada
contra um Postgres real pelos dois caminhos de escrita, com o custo do lock
medido (2,5 s para 500 mil linhas; a tabela tem ~33 mil). E os 122 KB de
`main.py` morto na cert-api foram removidos depois de provado o orfao — o
arquivo ainda carregava copias dos mesmos defeitos corrigidos em `app/`.

### Entregue pela segunda onda de agentes

**E-mail e envio.** A busca do Gmail passou a FALHAR FECHADA sem
`EMAIL_ALLOWED_SENDERS` — o cron de 5 minutos era o unico dos quatro caminhos
que nao abortava, e com a allow-list vazia listava e baixava anexo de todo
e-mail nao lido da caixa compartilhada, marcando como lida correspondencia nao
relacionada. Falha TRANSITORIA deixou de consumir a mensagem: erro de rede,
timeout ou 5xx devolve o log para `pending` e nao marca como lida, com contador
de tentativas para nao criar poison message; so 4xx (exceto 408/429) e tratado
como permanente. `MAIL_DRY_RUN` ligado por default fora de producao, num ponto
unico de entrega. A sentinela literal que detectava relay sem auth virou
`SMTP_AUTH_MODE`. Tetos de pagina, de mensagem e de bytes agregados na
paginacao do Gmail. `reprocess()` parou de reportar sucesso sem prova: usa
`rfc822msgid:`, extrai so o mailbox no fallback, devolve a contagem real e nao
marca `reprocessed` antes do sucesso.

**Validacao.** `Number()` cru sobre texto extraido por IA foi substituido por um
normalizador unico em todos os checks monetarios e quantitativos —
`Number('1.234')` valia 1,234 em vez de 1234, erro de mil vezes, e
`Number('1.234,56')` era `NaN`, que degradava o check para "documentos
insuficientes" apresentando como INDISPONIVEL um dado que existia. Comparacao
monetaria sem confirmacao de moeda igual passou a `skipped`/`warning` explicito.
`unit-type-validation` deixou de casar por substring ("PARKA" detectava "par",
"CORSET" detectava "set") e foi rebaixado de `failed` para `warning`, porque a
heuristica e linguistica e disparava e-mail de correcao para fornecedor externo.
`item-level-match` parou de colapsar SKU repetido e de tratar quantidade ausente
como zero.

**Comparativo e aceites.** `comparison_acceptances` deixou de ser tabela
write-only: `getComparison` passou a ler os aceites ATIVOS, e a tela para de
exibir "Aceito por Fulano" sobre extracao nova — que era exatamente o que a
invalidacao existia para impedir. O `evidence_hash` passou a cobrir os valores
divergentes que estao sendo aceitos, e o upsert nao ressuscita mais aceite
invalidado. `acceptComparison` passou a gravar em `audit_logs`. Editar celula
passou a exigir justificativa, como aceitar ja exigia — a governanca estava
invertida, porque editar transforma "Falha" em "Conforme" e era a unica das duas
sem justificativa. `autoPopulateItems` ganhou lock consultivo com recheque sob o
lock (dois `generate` concorrentes nao duplicam mais o lote) e passou a gravar a
linhagem exigida pela ADR 0006.

**Resiliencia.** Retry com backoff, jitter e `Retry-After` nas chamadas de
leitura de Drive, Sheets, Groups e Odoo — antes so o modulo de IA usava os
helpers que ja existiam. Escrita NAO entrou no retry: `files.create` nao e
idempotente e re-tentar cria uma segunda pasta ou arquivo. O `AbortSignal` passou
a chegar ao cliente do Google, entao o timeout cancela a requisicao em vez de so
desistir de esperar. `UnauthorizedError` criada: queda do Postgres durante o
login voltou a sair como 500 generico em vez de 401 "Credenciais invalidas".

**Processos e SLA.** `completed` e `sent_to_fenicia` voltaram a ter caminho para
`validating`, com motivo obrigatorio, restrito a admin e gravado em
`process_events` — fechar o desvio do PUT sem oferecer o caminho legitimo teria
deixado a operacao sem saida quando um OHBL corrigido chega depois do envio a
Fenicia. SLA e KPIs de conclusao pararam de usar `updatedAt` como data do
evento: editar uma nota num processo concluido em janeiro o recontabilizava como
"concluido neste mes".

### R-01 resolvido

Ver a nota completa em R-01: a centralizacao dos stubs de jsdom foi feita na
segunda tentativa, com stub CIENTE DA QUERY, e verificada nos dois sentidos.

## Estado das pendencias apos a segunda rodada

A lista P-01..P-26 abaixo foi escrita ao fim da PRIMEIRA rodada. A segunda
fechou a maior parte. Leia esta tabela antes da lista:

| Pendencia                                 | Estado                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P-01 ADR 0006                             | PARCIAL — idempotencia (lock consultivo + recheque) e linhagem entregues; dry-run/diff e chave unica por execucao seguem abertos |
| P-02 fonte canonica Desembaraco/Numerario | ABERTA — decisao de negocio                                                                                                      |
| P-03 janela de urgencia da LI             | ABERTA — decisao de negocio                                                                                                      |
| P-04 `numerarioPct` constante             | ABERTA — decisao de negocio                                                                                                      |
| P-05 cards fantasma do Meu Dia            | FECHADA (removidos)                                                                                                              |
| P-06 `completed` -> `validating`          | **FECHADA** — reabertura com motivo obrigatorio, admin e trilha                                                                  |
| P-07 periodo nos dashboards               | ABERTA — por decisao, com o motivo detalhado abaixo                                                                              |
| P-08 TanStack Query em Certificacoes      | ABERTA — refatoracao ampla, adiada                                                                                               |
| P-09 `processWithAI` lancar na lease      | ABERTA — precisa de politica de retry                                                                                            |
| P-10 `main.py` morto                      | **FECHADA** (122 KB removidos)                                                                                                   |
| P-11 `cert_stock.synced_at`               | **FECHADA** — migracao idempotente, validada contra Postgres real                                                                |
| P-12 risco do claim `hd`                  | FECHADA — checagem condicional, documentada                                                                                      |
| P-13 `TZ` no compose                      | **FECHADA na cert-api**; `api` e `postgres` NAO, por decisao fundamentada                                                        |
| P-14 bloqueadores do Drive                | CODIGO FECHADO; falta a confirmacao empirica contra o Shared Drive                                                               |
| P-15 canal de alerta                      | **FECHADA** — reentrega, backoff, teto, regra Prometheus, health honesto                                                         |
| P-16 aceites write-only                   | **FECHADA** — backend le e o frontend consome                                                                                    |
| P-17 `evidence_hash`                      | **FECHADA**                                                                                                                      |
| P-18 `Number()` cru                       | **FECHADA** — normalizador unico em todos os checks                                                                              |
| P-19 unidades antes de comparar           | **FECHADA**                                                                                                                      |
| P-20 `updatedAt` como data de evento      | **FECHADA** — `process_events` como fonte                                                                                        |
| P-21 retry/breaker nas integracoes        | **FECHADA na leitura**; escrita deliberadamente fora                                                                             |
| P-22 cancelamento no `withTimeout`        | **FECHADA** para Drive e Sheets; Odoo nao suporta                                                                                |
| P-23 ingestao de e-mail                   | **FECHADA**                                                                                                                      |
| P-24 `MAIL_DRY_RUN`                       | **FECHADA**                                                                                                                      |
| P-25 `proxy_pass` do Nginx                | **FECHADA** — validada reproduzindo o 502                                                                                        |
| P-26 `UnauthorizedError`                  | **FECHADA**                                                                                                                      |

### Pendencias NOVAS, surgidas na segunda rodada

- **Indice unico parcial de `comparison_acceptances`.** A correcao certa e
  tornar `(process_id, scope, row_key, evidence_hash)` parcial
  (`WHERE invalidated_at IS NULL`). Sem migration, a reafirmacao de uma evidencia
  identica depois de invalidada entra sob um hash derivado
  (`sha256(hash + ':reafirmacao')`), com teto de 50 encadeamentos. Funciona e
  esta provado em E2E, mas o `evidence_hash` da segunda reafirmacao em diante
  deixa de ser o hash puro da evidencia.
- **Escopo OAuth de Drive e Sheets.** A reducao para `.readonly` esta desenhada e
  NAO foi aplicada: falta confirmar com o admin do Workspace se o client ID da
  service account esta como "Confiavel" ou "Limitado a escopos especificos". Um
  dado que muda a analise: Drive e Sheets NAO usam Domain-Wide Delegation (so o
  Groups usa), entao a autorizacao por escopo do admin provavelmente nao se
  aplica a eles.
- **Dead-letter das filas.** Politica de retry declarada; job que estoura as
  tentativas ainda termina como `failed` sem ninguem varrer.
- **`/health/integrations` nao cobre** Gmail API, SMTP, IMAP, SYDLE, Odoo nem
  egress externo. `odooService.isConfigured()` existe pronto e nao e chamado.
  A prova de entrega de alerta, que era lacuna, JA foi coberta.
- **`/history-scan` continua sincrono** no ciclo HTTP; ganhou rate limit, mas a
  correcao real e enfileirar.
- **Anexos de e-mail continuam inteiros em memoria**, com orcamento agregado
  limitando o dano. Streaming e refatoracao maior no `documentService.upload`.
- **Contador de tentativa transitoria mora no `errorMessage`** dos logs de
  ingestao, por falta de coluna propria. Funciona; `retry_count` seria o lugar
  certo.
- **Aceite de linha de cruzamento nao fica preso aos valores.** As linhas que a
  tela monta a partir de `crossDocumentChecks` e a coluna Sistema nao existem em
  `getComparison`, entao para elas o `evidence_hash` volta a ser praticamente so
  identidade e nota. Fechar exige ler o relatorio de validacao dentro de
  `acceptComparison`, com risco de import circular.
- **Custo do `acceptComparison`** subiu: agora executa um `getComparison`
  completo por aceite. E acao manual, uma por linha, mas e regressao real.

## Pendencias que NAO foram resolvidas

Cada item diz por que ficou aberto. Nenhum foi omitido por conveniencia.

### Bloqueadas por decisao de negocio

**P-01 — ADR 0006: materializacao idempotente de `process_items`.**
`autoPopulateItems` recebeu ordenacao deterministica e gate de confianca, mas
a ADR pede mais: `source_document_id`, `extraction_run_id`, chave unica por
processo+execucao+identidade do item, substituicao transacional auditada,
dry-run/diff e invalidacao explicita apos nova extracao. Sem isso, dois
`generate` concorrentes ainda inserem o lote duas vezes. E trabalho de
migration + refatoracao, nao de correcao pontual.

**P-02 — fonte canonica de Desembaraco e Numerario.**
As duas telas leem exclusivamente chaves de `ai_extracted_data`
(`desembaraco`, `canal`, `numeroDI`, `freeTime`, `valorNumerario`...) cujo
UNICO produtor e `scripts/update-processes-extra-data.js`, um script manual
que nao e referenciado por nenhum `package.json`, cron, controller ou workflow.
Enquanto isso, `ProcessEditPage` grava `customsChannel` e `customsClearanceAt`
em colunas tipadas. **Um analista que preenche o canal aduaneiro no formulario
do processo nunca ve o resultado na tela de Desembaraco.** Corrigir exige
definir com o time fiscal qual e a fonte de verdade de cada campo — nao e
decisao de engenharia.

**P-03 — janela de urgencia da LI.** `LI_URGENT_WINDOW_DAYS = 15` foi escolhido
por mim como default defensavel (`calculateLiDeadline` usa embarque + 13 dias).
Precisa de confirmacao do time fiscal.

**P-04 — `numerarioPct` e uma constante por construcao.**
`financial/calculations.ts` calcula `numerarioValue / customsValueBrl` onde
`numerarioValue = customsValueBrl * 0.6`, entao o resultado e sempre 0,6. O
proprio docstring admite que falta a coluna de "aduaneiro de referencia", e o
teste fixa `toBe(0.6)`. A coluna `numerario_pct` e persistida e qualquer
leitura dela como indicador esta lendo uma constante. Ou remove a persistencia,
ou a operacao fornece a referencia real.

**P-05 — cards de Cambio, Numerario e Desembaraco do Meu Dia foram REMOVIDOS.**
Eles nunca funcionaram: o tipo declarava `pendingCambio`, `pendingNumerario` e
`pendingDesembaraco`, e `getSla()` nunca devolveu esses campos —
`undefined?.length > 0` e sempre falso. Nao e regressao, e remocao de codigo
morto. Se a operacao quiser a funcionalidade, e escopo novo: agregacoes em
`getSla` mais as telas correspondentes.

**P-06 — `completed` e `sent_to_fenicia` nao voltam para `validating`.**
A state machine nao tem caminho de volta, e nem permite cancelar processo
concluido. Chegando um OHBL corrigido depois do envio a Fenicia, nao existe
caminho suportado para revalidar. O `PUT` que permitia o desvio foi FECHADO
nesta sessao — o que torna a lacuna visivel em vez de contornavel sem trilha.
Abrir `completed -> validating` com motivo obrigatorio e decisao de processo.

### Escopo declarado fora desta rodada

**P-07 — recorte por periodo nos dashboards.** A validacao fantasma foi
removida; o filtro NAO foi implementado, e a decisao de nao implementar e
deliberada.

Nao e falta de tempo: e que "periodo" nao tem UM significado obvio para os
indicadores que essas telas mostram, e escolher por conta propria seria inventar
regra de negocio. Tres exemplos concretos do que precisa ser decidido antes:

- "FOB no Mes" e "Concluidos no Mes" sao, por definicao, recortes MENSAIS. Com
  um intervalo livre de 12/03 a 27/06, o rotulo deixa de fazer sentido — o
  indicador passa a ser outro, com outro nome.
- O `ChangeBadge` compara o valor com o MES ANTERIOR. Com intervalo livre, nao
  existe "anterior" obvio: e o intervalo imediatamente anterior de mesma
  duracao? O mesmo intervalo do ano passado? Nenhum dos dois e obviamente certo.
- O `avgDaysInStatus` e um retrato do agora. Filtrar por periodo um indicador de
  estado atual nao tem significado sem definir se "no periodo" quer dizer
  "processos criados no periodo" ou "processos que estiveram naquele status
  durante o periodo" — que sao numeros diferentes.

O trabalho de encanamento e pequeno; a definicao e que falta. Levar para o time
fiscal com estas tres perguntas fechadas e mais barato que implementar duas
vezes.

**P-08 — Certificacoes nao usa TanStack Query.** As 9 paginas usam
`useState` + `useEffect` + `fetch` manual: nenhuma mutation invalida cache,
`checkCertApiHealth()` e chamado 3x ao abrir o dashboard, e o dashboard nao tem
botao de atualizar. E a causa raiz de varias inconsistencias do modulo.
Migracao ampla, deliberadamente adiada.

**P-09 — `processWithAI` nao lanca quando a lease falha.** A guarda de
`reclassify` foi aplicada, mas o job continua sendo marcado como concluido pelo
pg-boss quando perde a lease, sem retry. Fazer lancar exigiria provar que o
retry nao dispara extracao de IA duplicada (e custo duplicado) em todos os
caminhos, inclusive o fallback fora da fila. Precisa de decisao sobre
`retryLimit`/backoff antes.

**P-10 — `main.py` da cert-api (122 KB) e codigo morto.** O Dockerfile roda
`app.main:app` e nada referencia `main:app`. Ele ainda carrega copias dos
MESMOS defeitos corrigidos nesta sessao, incluindo o `day_of_week` errado.
Remover merece PR proprio, junto com `main.py.legacy`.

### Bloqueadas por acesso ou ambiente

**P-11 — migracao de `cert_stock.synced_at` para `TIMESTAMPTZ`.**
A coluna e naive e recebe `datetime.now(UTC).isoformat()`; o Postgres descarta
o offset, o navegador le como horario local e a tela mostra o sync 3h ADIANTE
do horario real. O statement correto e reversivel esta identificado
(`ALTER TABLE cert_stock ALTER COLUMN synced_at TYPE TIMESTAMPTZ USING
synced_at AT TIME ZONE 'UTC'`), mas provar que e segura exige inspecionar os
dados de producao — saber se toda linha foi escrita pelo mesmo caminho,
incluindo as que cairam no `DEFAULT NOW()`. Nao aplicada.

**P-12 — risco residual do `hd` no login Google.** A verificacao de `hd` foi
deliberadamente suavizada: **exigida apenas quando o claim esta presente**. Se
fosse exigencia dura e o Google nao emitisse o claim, NINGUEM entraria no
sistema, e a recuperacao exigiria mudar `ALLOWED_DOMAIN` no SOPS e redeployar
durante o incidente. Com `email_verified` obrigatorio, o Google nao emite
e-mail verificado do dominio para conta de consumidor, entao a suavizacao
praticamente nao custa seguranca. Registrado para ninguem "endurecer de volta"
sem entender o custo.

**P-13 — `TZ: America/Sao_Paulo` no `docker-compose.prod.yml`.** O servico
`cert-api` roda em UTC. A derivacao ja nao depende disso (passou a calcular o
dia no fuso da operacao explicitamente), mas logs, `NOW()` do Postgres via
default e qualquer `date.today()` futuro continuam em UTC. Alteracao de
infraestrutura, fora do que foi autorizado.

**P-14 — confirmacao empirica dos dois bloqueadores do Drive.**
Os DOIS foram corrigidos no codigo, mas nenhum dos dois foi confirmado contra o
Drive real, porque isso exige a pasta operacional compartilhada com a conta de
servico — que e justamente o que ainda falta no rollout.

- `supportsAllDrives` foi acrescentado ao download e as sete escritas, com
  guarda estatica que falha se alguem adicionar uma chamada nova sem a flag.
  So um download real de arquivo do Shared Drive prova que a virada funciona.
- `driveFileId` deixou de ser sobrescrito: `uploadToDrive` agora recusa
  re-subir documento cuja `ingestionSource` e `drive`. A guarda ficou no ponto
  UNICO de escrita da coluna, e nao nos tres chamadores, para que nenhum
  caminho novo consiga fura-la por esquecimento. Coberto por teste nos tres
  casos (`drive`, `manual`, `email`). Falta inspecionar
  `documents.drive_file_id` apos uma ingestao real para fechar o ciclo.

### Canal de alerta — continua morto por construcao

**P-15.** Este e o item mais grave ainda aberto, e a causa nao e credencial.
Tres defeitos encadeados:

1. `alerts/service.ts` retorna o alerta duplicado ANTES de tentar entregar,
   sem verificar `sentToChat`. Se a primeira tentativa do dia falha, as
   seguintes nem sao tentadas.
2. `sent_to_chat = false` NAO E LIDO por nenhum job, rota ou servico em todo o
   repositorio. Um alerta que falha na entrega morre no banco. E o mecanismo
   exato dos 6.349 registros com zero entregas.
3. O cooldown do circuit breaker do Google Chat descarta em silencio por 30
   minutos, sem enfileirar nada.

A UI passou a mostrar quais alertas nao foram entregues — o operador agora
CONSEGUE ver o problema — mas a reentrega em si nao foi implementada. Exige
uma fila de reentrega com backoff e teto, mais uma regra Prometheus sobre
`alert_delivery_total`, que existe e esta bem instrumentada e sobre a qual
nenhuma regra alerta.

### Debito registrado, nao corrigido

- **P-16** — `comparison_acceptances` e tabela write-only: e escrita e
  invalidada, mas NENHUM `SELECT` existe no repositorio. A tela deriva o aceite
  de `process_events`, entao o backend invalida um aceite que a tela continua
  exibindo apos reprocessamento.
- **P-17** — `evidence_hash` do aceite nao inclui os valores divergentes que
  estao sendo aceitos; o nome promete uma coisa e o conteudo entrega outra.
- **P-18** — `Number()` cru sobre texto extraido por IA em ~10 checks de peso,
  CBM, caixas e frete: `Number('1.234,56')` e `NaN` e `Number('1.234')` e
  1,234 — erro de mil vezes. Existem dois parsers corretos no repositorio que
  nao sao usados nesses pontos.
- **P-19** — nenhum check verifica UNIDADE antes de comparar peso, volume ou
  moeda. Uma invoice em EUR gera falha de moeda E uma comparacao numerica
  contra o FOB em outra moeda.
- **P-20** — SLA e KPIs de conclusao usam `updatedAt` como se fosse a data do
  evento. Editar uma nota num processo concluido em janeiro o recontabiliza
  como "concluido neste mes".
- **P-21** — `withRetry`/`CircuitBreaker` existem e sao usados apenas pelo
  modulo de IA. Nenhuma chamada Gmail, Drive, Sheets, SMTP ou Chat usa retry
  ou backoff.
- **P-22** — o `withTimeout` local dos clientes Google teve o vazamento de
  timer corrigido, mas continua sem cancelar a requisicao em voo. O
  cancelamento real exige propagar `AbortSignal` ate o cliente.
- **P-23** — ingestao de e-mail marca a mensagem como lida mesmo em falha
  transitoria, e a query do Gmail falha ABERTA quando `EMAIL_ALLOWED_SENDERS`
  esta vazio (o default no Compose e vazio) — os outros tres chamadores
  abortam nesse caso; so o cron de 5 minutos nao.
- **P-24** — `MAIL_DRY_RUN` inexistente: nada consulta `NODE_ENV` para
  bloquear envio real fora de producao. A unica barreira e a allow-list de
  destinatario, que um dump de producao herda.
- **P-25** — `infra/nginx/prod.conf` usa `proxy_pass` com hostname literal,
  o padrao que `apps/web/nginx.conf` documenta como causa raiz do incidente de 502. A correcao foi aplicada em apenas um dos dois arquivos de Nginx.
- **P-26** — `UnauthorizedError` ausente em `shared/errors/`: `login` agora
  responde 401 "Credenciais invalidas" tambem quando o Postgres cai. O
  diagnostico piora para o usuario final e melhora no log; a correcao de raiz e
  distinguir 401-de-credencial de 500-de-infra.

### Decisoes tomadas nesta sessao que a operacao pode querer revisar

**D-A — nunca-validados saiaram do denominador da taxa de conformidade.**
Somar produto sem veredito nenhum afundava o percentual sem significar
desconformidade. A decisao esta coberta por teste; se o time fiscal preferir o
denominador cheio, e uma linha.

**D-B — `incoterm` NAO e limpavel.** Os outros 24 campos do processo aceitam
`null` para apagar; `incoterm` ficou de fora porque tem `default('FOB')` no
banco e "apagar" e ambiguo (grava NULL ou volta para FOB?). Congelado em teste
nas duas direcoes, para nao regredir sem alguem ver.

**D-C — ordenacao da lista de produtos de Certificacao foi ROTULADA, nao
removida.** O cert-api nao aceita `sort`/`order`, entao a reordenacao e local a
pagina exibida. Sobre 25 linhas ela e util; o que nao podia ficar de pe era a
ilusao de alcance global. Ordenacao de verdade exige mudanca de backend.

**D-D — janela de urgencia da LI em 15 dias.** Ver P-03.

### Mudanca de comportamento visivel

**MC-01 — documento vindo do Drive nao ganha mais copia com nome padronizado.**
A correcao que impede a sobrescrita do `driveFileId` faz `uploadToDrive` recusar
re-subir documento cuja `ingestionSource` e `drive`. Como efeito, uma
invoice/certificate ingerida pelo Drive mantem o nome que o operador deu, na
pasta em que ele a colocou, em vez de ganhar a copia renomeada por
`standardizeDocumentName`. E o comportamento correto — renomear e copiar era
justamente o que quebrava a chave de deduplicacao e causava reimportacao a cada
dez minutos — mas e visivel para quem esperava o nome padronizado.

### Risco tecnico introduzido e registrado

**R-01 — `useTheme()` lanca fora do `ThemeProvider`.** `CertDashboardPage` e
`CertBrandChart` passaram a consumir o contexto de tema para os graficos
responderem ao modo escuro. O `App` sempre provê e os 82 E2E passam, mas
qualquer teste futuro que renderize essas telas precisa envolver em
`<ThemeProvider>` e stubar `matchMedia` e `ResizeObserver`. Hoje dois arquivos
de teste fazem isso localmente, cada um do seu jeito.

RESOLVIDO na segunda rodada, depois de uma tentativa malsucedida.

A primeira tentativa definiu `matchMedia` global devolvendo `matches: false`
para qualquer query, e quebrou quatro testes de `CertificacoesLayout` e
`ImportacaoLayout`. A causa: `AppLayout.tsx:78-80` trata a AUSENCIA de
`matchMedia` como DESKTOP —

    typeof window.matchMedia !== 'function' ? true : matchMedia(q).matches

— entao um stub que responde `false` para tudo faz a aplicacao inteira se
comportar como mobile, o menu colapsa e os itens de navegacao somem da arvore
acessivel.

O stub definitivo e CIENTE DA QUERY: responde `true` para `min-width`
(preservando exatamente o default anterior) e `false` para
`prefers-color-scheme: dark`. E condicional, entao um teste que precise de
mobile continua sobrescrevendo — `AppLayout.test.tsx` faz isso de proposito.

Verificado nos dois sentidos: com os stubs centralizados, 225/225 passam e o
stub local redundante de `CertDashboardPage.test.tsx` pode sair; removendo os
stubs do setup, esse mesmo arquivo falha com `window.matchMedia is not a
function`. A centralizacao e load-bearing, nao decorativa.

## Achados refutados — registrados para nao voltarem

Auditoria ampla produz falso positivo. Estes foram investigados e NAO se
sustentaram; nenhum virou alteracao de codigo.

- **`includeRead` sempre `false` em `email-ingestion/controller.ts`.**
  A suspeita era que `req.query.includeRead === true` nunca seria verdadeiro,
  porque valor de query string e sempre texto. REFUTADA: o middleware
  `shared/middleware/validate.ts` reescreve `req.query` com o resultado do Zod,
  entao o valor chega como booleano real.

- **Injecao na query do Gmail via parametro `q`.** MITIGADA e nao exploravel:
  `email-ingestion/schema.ts` aplica a regex `^[^{}()|&;$\`]\*$`, alem de
`adminMiddleware` e rate limit.

- **`CRON_DOW_ALIASES` conviveria com outra convencao dentro da cert-api.**
  A constante NAO existe na cert-api — esta no frontend
  (`CertAgendamentosPage.tsx`). As duas convencoes conviviam dentro do
  frontend, nao entre frontend e backend. O bug do dia da semana e a correcao
  seguem validos; so a localizacao estava errada no briefing.

- **`bypass` de `alg:none` no JWT.** O `jsonwebtoken` 9 ja restringe a HMAC
  quando o segredo e string. O pin de algoritmo foi aplicado como defesa em
  profundidade, nao como correcao de vulnerabilidade.

- **Direcao do erro de fuso em `cert_stock.synced_at`.** O briefing dizia que
  a tela mostrava 3h A MENOS; a leitura do codigo provou o contrario — mostra
  3h ADIANTE, porque o Postgres descarta o offset do `isoformat()` UTC e o
  navegador le o valor sem sufixo como horario local. O estoque parece mais
  fresco do que e.

- **Falha em `ai/__tests__/provider-selection.test.ts`.** Aparecia em execucoes
  da suite completa e foi investigada como possivel regressao, inclusive com um
  agente stashando as proprias mudancas para isolar. Rodado isolado: 8 testes,
  2,6 s, passa. Era timeout de 5 s no import sob carga dos agentes paralelos —
  flake de ambiente, nao defeito. A hipotese de relacao com a rede
  `ia-local-net` foi explicitamente retirada.

- **Ciclo de import ao reutilizar `spreadsheetBufferToText`.** A preocupacao era
  que importar de `documents/service.ts` no `email-ingestion/processor.ts`
  criaria ciclo. Nao cria: `documents/service.ts` nao importa nada de
  `email-ingestion/`, e o processor ja importava `documentService` do mesmo
  arquivo. A dependencia e de mao unica e ja existia.

## Notas de metodo, para a proxima sessao

1. **Gate verde nao e evidencia de corretude.** O baseline estava inteiramente
   verde e continha um agendamento que disparava no dia errado, filtros que nao
   filtravam e uma integracao que entregaria zero documentos. Onde uma correcao
   foi aplicada nesta sessao, ela veio acompanhada de teste que a congela — e
   varios desses testes sao guardas estaticas, nao testes de unidade, porque o
   defeito estava na AUSENCIA de uma declaracao, nao no comportamento de uma
   funcao.

2. **Guardas estaticas valem onde o defeito e invisivel em teste.** Duas foram
   criadas: uma que exige `supportsAllDrives` em toda chamada da API do Drive
   (a maioria so falharia contra um Shared Drive real) e outra que exige que
   todo tom de cor usado exista no `@theme` (o Tailwind v4 nao gera classe para
   tom inexistente e nao emite erro).

3. **Paralelismo cobra pedagio de leitura.** Sete agentes editando a mesma
   arvore produziram quatro leituras de estado intermediario que pareciam
   defeito e nao eram: um schema lido antes de a alteracao entrar, um helper
   existindo por 30 segundos sem uso, um `export` conferido antes de ser
   escrito, e um teste falhando por timeout sob carga. Nenhuma custou trabalho
   perdido, mas todas custaram uma rodada de mensagem. Particao de arquivos
   resolve conflito de ESCRITA; nao resolve confusao de LEITURA.

4. **Dois agentes desviaram da instrucao e estavam certos.** Um recusou usar a
   mesma query key nas duas telas de modelos porque as URLs diferem e o cache
   colapsaria; outro recusou fazer `processWithAI` lancar sem provar que o
   retry nao dispararia extracao de IA paga em duplicidade. Os dois desvios
   foram aceitos. Instrucao detalhada nao substitui julgamento de quem esta
   lendo o codigo.

## Gate final — saida real dos comandos

Executado com todos os agentes parados, apos `npm run format`:

```text
npm run format:check        -> exit 0  ("All matched files use Prettier code style!")
npm run lint                -> exit 0
npm run typecheck           -> exit 0
npm test                    -> exit 0
                               API 1.494 passed | 1 skipped (155 arquivos)
                               web   225 passed             (51 arquivos)
npm run test:e2e -w apps/api-> 63 passed (8 arquivos, PostgreSQL real + migrations)
npm run build               -> exit 0
npm run test:e2e:web        -> 82 passed (2.5 min), 0 falhas
npm audit --omit=dev        -> 0 vulnerabilidades

apps/cert-api:
  ruff check .              -> All checks passed!
  pytest                    -> 595 passed
```

### Comparacao com o baseline

| Gate                             | Antes          | Depois         |
| -------------------------------- | -------------- | -------------- |
| Testes API                       | 1.005 + 1 skip | 1.494 + 1 skip |
| Testes web                       | 146            | 225            |
| Testes cert-api                  | 523            | 595            |
| E2E API (banco real)             | 48             | 63             |
| Playwright                       | 82             | 82             |
| Lint / typecheck / build / audit | verdes         | verdes         |

**+708 testes.** Cada correcao de comportamento veio acompanhada do teste que a
congela. Boa parte deles foi verificada por MUTACAO: desligar a correcao e
confirmar que o teste falha. Isso pegou pelo menos dois testes que passavam com
a correcao desligada — um porque um `early return` anterior cortava antes de a
asercao ser alcancada.

### Uma execucao do Playwright falhou e NAO era regressao

A primeira tentativa do gate final deu 68 falhas. As 14 primeiras rotas
passaram e, a partir de `/importacao/cambios`, tudo virou
`ERR_CONNECTION_REFUSED` na porta 4174: o servidor de dev que o proprio
Playwright sobe tinha morrido no meio da execucao, com a maquina em load average
28-42 por causa de varias suites concorrentes.

A classificacao das 68 falhas confirma: **68 de 68 sao `ERR_CONNECTION_REFUSED`,
zero sao falha de renderizacao ou de asercao.** Subir o servidor de dev
separadamente e rodar o Playwright contra ele (o `reuseExistingServer` da
config permite) devolveu 82/82 com zero falhas de conexao, duas vezes.

Fica a nota operacional: o E2E web nao e confiavel com a maquina saturada. Em
gate que importa, suba o servidor antes e rode o Playwright contra ele.

## Estado de retomada

- Nenhum commit, push, deploy, migration remota, envio de e-mail, replay ou
  escrita em sistema externo foi executado. A arvore de trabalho tem 157
  arquivos alterados ou novos, prontos para revisao.
- Proximo passo seguro: revisao do diff e commit; depois homologacao com dados
  representativos e, so entao, release em janela autorizada.
- Antes de virar `DOCUMENT_SOURCE` para `drive`, exigir o smoke que baixa de
  fato um arquivo da pasta operacional do Shared Drive e a inspecao de
  `documents.drive_file_id` apos uma ingestao real (P-14).
- As decisoes de negocio em aberto estao em P-01 a P-06; a mais urgente
  operacionalmente e P-02, porque hoje o analista preenche o canal aduaneiro no
  formulario do processo e nunca ve o resultado na tela de Desembaraco.

## Deploy de producao — 2026-08-29

Autorizado explicitamente pelo usuario. Executado por `scripts/deploy.sh` no
alvo padrao `192.168.168.124` (host `n8n`), com SHA `956f7d3`.

### Preflight que mudou a decisao

A rede corporativa, inacessivel na sessao de 2026-08-26, **voltou a responder**
(portas 22 e 443 abertas). Antes de qualquer escrita, o reconhecimento
somente-leitura do host encontrou `NODE_ENV=development` no `.env` remoto, o
que — com a mudanca de `MAIL_DRY_RUN` desta sessao — teria silenciado todo o
e-mail operacional.

**Esse alarme NAO se sustentou**, e vale registrar por que: o
`docker-compose.prod.yml` fixa `NODE_ENV: production` na linha 64, entao o
valor do `.env` nunca chega ao container da API. O `NODE_ENV=development`
remoto e inerte para a API.

A verificacao, porem, expos um defeito real e independente da configuracao:
`deliverMail` devolve `delivered: false` em dry-run e o chamador IGNORAVA o
retorno, gravando `status: 'sent'` com `sentAt` e uma linha de timeline
dizendo "E-mail enviado para X". Corrigido antes do deploy — o mesmo padrao do
incidente ja registrado, do banco afirmando um envio que nao aconteceu.

Tambem foi corrigido que `MAIL_DRY_RUN` e `SMTP_AUTH_MODE` nao constavam do
compose de producao: um operador podia defini-las no `.env` e nao ver efeito
nenhum, porque o compose so repassa o que lista.

Conferido antes do deploy, sem imprimir valor de segredo: `SMTP_USER` e a
sentinela do relay interno, entao a auth SMTP continuava desligada com o
default novo (`none`) — sem mudanca de comportamento.

### Execucao

```text
[1/8] backup obrigatorio      -> pgdump 2,5M + volume uploads, integridade verificada
[2/8] snapshot para rollback  -> /home/nicolas/importacao.rollback
[3/8] rsync + sops            -> .env preservado (excluido do rsync)
      gate SYDLE              -> SYDLE_SYNC_ENABLED=true, liberado por
                                 ALLOW_SYDLE_SYNC_DEPLOY=1
[4/8] alertmanager            -> ALERTMANAGER_WEBHOOK_URL vazio, mantido noop
[5/8] compose remoto          -> valido
[6/8] migrations              -> "Found 18 forward-only SQL migrations (>= 11)"
[7/8] build api+web+cert-api  -> containers recriados
[8/8] health                  -> api ready, cert-api ready, web, e proxy /api
                                 (browser -> nginx -> api): todos OK
```

Sem rollback. As unicas ocorrencias de "error" no log sao caminho de arquivo,
a mensagem do snapshot e um `NOTICE` de idempotencia da 0025.

### O que a producao provou

**A correcao das migrations funcionou.** O boot logou `Found 18 forward-only
SQL migrations (>= 11)`. A lista escrita a mao cobria 14 (0011..0024); agora
sao 18 (0011..0028). Confirmado no banco: `alerts.delivery_attempts`,
`process_items.source_document_id` e `documents.ingestion_source` existem.

**O job de reentrega esta vivo.** O scheduler registrou
`alert-redelivery (*/5 min)`.

**E a primeira coisa que ele fez foi expor um problema que estava invisivel.**
Os tres unicos erros nos logs pos-deploy sao o webhook do Google Chat
falhando, com a mensagem `Google Chat webhook falhando (verifique
GOOGLE_CHAT_WEBHOOK_URL/key) — pausando notificacoes pelo cooldown`.

Estado da tabela `alerts` logo apos o deploy:

| metrica                           | valor |
| --------------------------------- | ----- |
| total                             | 5.067 |
| entregues (`sent_to_chat = true`) | **0** |
| com tentativa registrada          | 3     |
| com motivo da falha gravado       | 27    |
| pendentes nas ultimas 24h         | 28    |

E exatamente o comportamento desenhado: o job pegou a janela de 24h, tentou,
o breaker abriu depois de 3 falhas reais, e as demais registraram o MOTIVO sem
consumir tentativa (27 com motivo contra 3 com tentativa). `sent_to_chat`
segue `false`, entao continuam elegiveis — no momento em que a chave do
webhook for rotacionada, os alertas das ultimas 24h saem de verdade.

Antes deste deploy essa falha era muda: o alerta morria no banco e ninguem
lia. Agora ela esta no log em nivel de erro, com instrucao, e no banco com
motivo.

### Pendencias que o deploy nao resolve

- **Rotacionar a chave/webhook do Google Chat.** E a unica coisa que separa
  5.067 alertas detectados de alertas efetivamente entregues. Exige segredo,
  entao depende do usuario.
- **`ALERTMANAGER_WEBHOOK_URL` esta vazio**, entao o Alertmanager segue com
  receiver `noop`. A regra `AlertDeliveryFailing` foi implantada e vai
  disparar — para lugar nenhum, ate essa URL existir.
- **`revision` do `/health/live` volta `null`**: a variavel de revisao nao esta
  definida no ambiente, entao o health nao diz qual SHA esta rodando.
- As confirmacoes empiricas de P-14 (download real do Shared Drive) e o aval
  do admin do Workspace para reduzir escopos OAuth continuam abertos.

---

## Revisao pos-deploy — 2026-08-29, uma hora depois de 956f7d3

Esta secao registra o que a revisao da propria entrega encontrou DEPOIS que ela
ja estava rodando em producao. O gate continuava 100% verde o tempo todo:
`format:check`, `lint`, `typecheck`, `build`, 1.494 testes de API, 226 de web,
63 E2E de API, 595 pytest da cert-api, `ruff check` limpo.

O metodo que produziu os achados nao foi reler o codigo — foi **medir o sistema
rodando**. Todos os tres defeitos abaixo sao invisiveis em teste e visiveis em
producao.

### D-01 (ALTA) — a recusa do canal apagava o diagnostico do operador

`apps/api/src/modules/alerts/delivery.service.ts`

O caminho de recusa do canal (cooldown do breaker, webhook ausente) escrevia
duas colunas sem ter tentado nada:

- `last_delivery_error`, que e o unico texto que o operador le na Central de
  Alertas para saber POR QUE um alerta nao chegou;
- `last_delivery_attempt_at`, que e a chave do `ORDER BY` da fila de reentrega.

Medicao em producao, 21h00 de 2026-08-29:

```
tentativas_reais | erro_gravado                          | qtd
0                | Canal em cooldown apos falhas...      |  23
1                | Canal em cooldown apos falhas...      |   3   <-- apagado
1                | Falha ao entregar no Google Chat...   |   1
```

Tres dos quatro alertas que tiveram falha REAL de transporte estavam exibindo
"canal em cooldown". O operador concluiria que o canal esta apenas pausado,
quando o webhook respondeu erro — a mesma familia de defeito ja registrada
neste projeto: o sistema apresenta ausencia de sinal como ausencia de problema.

Correcao: so tentativa real carimba `last_delivery_attempt_at`; o motivo de
recusa do canal usa `coalesce` e nunca sobrescreve causa ja conhecida.

### D-02 (MEDIA) — o job de reentrega escrevia sem entregar

`apps/api/src/jobs/alert-redelivery.ts`

Com o breaker aberto nada pode ser entregue, mas a passada varria 25 linhas e
gravava 25 UPDATEs mesmo assim. Medido: **11 ciclos em 55 minutos, ~275
escritas, zero entregas.** Pior que desperdicio, porque cada no-op mexia na
coluna que ordena a fila (D-01).

Havia um efeito de segunda ordem: como a recusa do canal nao consome tentativa
(decisao correta e deliberada), `delivery_attempts` ficava em 0, e o backoff e
calculado a partir dele — `backoffMinutes(0) = 5 min`, exatamente o periodo do
cron. O backoff exponencial 5-10-20-40-80 era **inerte justamente quando o canal
estava com problema**, que e quando ele existe para agir.

Correcao: saida cedo quando `isChatCooldownActive()`. Estado do canal e do
canal, nao de cada alerta.

**Nota de metodo — por que os testes nao pegaram.** Havia teste para cada peca,
e todos corretos: cooldown nao consome tentativa; o backoff cresce com as
tentativas; o teto interrompe. Nenhum compunha as tres. O defeito morava na
composicao. Um dos testes, alem disso, **trancava o comportamento errado**
(`expect(patch.lastDeliveryAttemptAt).toBeInstanceOf(Date)`) e teve de ser
reescrito. Teste que congela defeito e pior que ausencia de teste, porque
transmite confianca.

### D-03 (MEDIA) — mensagem crua do driver chegando ao cliente

`apps/api/src/shared/utils/response.ts`

Sonda de seguranca provou tres saidas chegando intactas a um usuario
autenticado, pelos controllers de documentos:

```
connect ECONNREFUSED 172.19.0.4:5432            -> topologia da rede interna
column "comparison_field_overrides.field_key"   -> esquema do banco
value too long for type character varying(500)  -> tipo e limite da coluna
```

O idioma do repositorio e `catch (error) { sendError(res, error.message) }`, em
107 pontos de chamada. A redacao foi para o `sendError`, unico ponto de saida:
vale por padrao e rota nova nasce protegida.

Alternativa descartada, com o motivo: "so `AppError` passa, o resto vira
mensagem generica" apagaria 80 mensagens escritas para o operador ler, porque a
hierarquia so esta meio adotada — 82 lancamentos de `AppError` contra 80
`throw new Error` cru. A redacao tira o identificador de maquina e preserva o
texto humano.

**A propria correcao tinha um defeito**, achado na revisao dela uma hora depois:
a alternancia de raizes de caminho estava da mais curta para a mais longa e sem
fronteira de palavra, entao `/apps/web/src/main.tsx` casava so `/app` e devolvia
`[caminho interno]s/web/src/main.tsx` — o vazamento continuava, agora com
aparencia de tratado. Corrigido e coberto.

### D-04 (BAIXA) — artefatos de build rastreados

`*.tsbuildinfo` ja estava no `.gitignore`, mas gitignore nao vale para arquivo
ja rastreado: os tres saiam no diff a cada build, e o merge 956f7d3 levou dois
deles junto com codigo. `git rm --cached` resolve sem tirar do disco.

### E-01 — `/health/live` nunca soube dizer qual SHA rodava

`apps/api/src/modules/health/routes.ts`

Lia `process.env.REVISION`, variavel que **nada no repositorio define**. O deploy
injeta o SHA como `APP_VERSION` e ainda grava um ARQUIVO `REVISION` no servidor
que nenhum processo le. As duas pontas nunca se encontraram, e o campo respondeu
`null` durante toda a vida do endpoint.

Custo concreto: nesta propria revisao, confirmar qual SHA estava em producao
exigiu inspecionar o servidor na mao.

A guarda estatica que acompanha nao confere um nome fixo — confere que o nome
LIDO pelo endpoint e um nome que o compose de producao ENTREGA.

### O que foi verificado e estava correto

Registrado porque hipotese refutada vale tanto quanto achado confirmado:

- **Rate limiter atomico com `INCR`**: a hipotese era que chaves `rl:*` antigas,
  gravadas como JSON pela versao anterior, fariam o `INCR` estourar e derrubar o
  limitador para memoria. Medicao: zero erros de cache e nenhuma chave `rl:*` no
  Redis. Refutada.
- **Starvation da fila de reentrega**: a hipotese era que um alerta cujo envio
  LANCASSE excecao ficaria com `last_delivery_attempt_at` nulo para sempre e,
  com `NULLS FIRST` + `LIMIT`, travaria a fila. Refutada na leitura:
  `sendToGoogleChat` tem try/catch total e devolve `false`, nunca lanca.
- **Migracao TIMESTAMPTZ da cert-api**: nao logou nada no boot, o que levantou a
  suspeita de que nao rodou. `information_schema` confirma
  `cert_stock.synced_at` como `timestamp with time zone`. Aplicada.
- **Jobs supostamente parados**: `email-check`, `sydle-sync` e `drive-ingestion`
  apareciam com zero linhas de log. Era artefato do padrao de busca, nao
  ausencia de execucao — `SYDLE sync completed` aparece 7 vezes em 90 min,
  buscando 3 registros com zero erros, e `email-check` so loga em nivel `debug`
  no caminho normal. Nenhum job parado.
- **`ruff format`**: 28 arquivos divergem, mas 26 ja divergiam antes do merge e o
  CI roda apenas `ruff check` (que passa). O projeto nunca adotou `ruff format`;
  reformatar agora seria um diff de 28 arquivos sem relacao com a tarefa. Fica
  como divida registrada, nao como correcao.

### Segunda rodada — o que a revisao adversarial achou no codigo ja implantado

Tres defeitos no modulo de alertas, todos no codigo que subiu em 956f7d3.
Os dois primeiros vem do mesmo engano de projeto: **a regra estava no chamador
em vez de estar no ponto de decisao.**

#### D-05 (ALTA) — a criacao de alerta furava o teto e o backoff

`isDueForRetry` e `backoffMinutes` viviam so em `jobs/alert-redelivery.ts`. Mas
o job nao e o unico chamador de `attemptDelivery`: `alertService.create()`
tambem chama, no caminho de deduplicacao, e nao consultava nenhuma das duas.

Como `handleCronError` cria um alerta a cada falha de cron, um job quebrado
rodando de 5 em 5 minutos produzia **~288 tentativas por dia** contra um webhook
que ja havia recusado — exatamente o que o teto de 5 existe para impedir.

Correcao: as duas funcoes foram para `delivery.service.ts`, junto de
`MAX_DELIVERY_ATTEMPTS`, e a decisao entrou no comeco de `attemptDelivery`.
Qualquer chamador, inclusive um futuro, obedece por construcao.

#### D-06 (ALTA) — duplicacao sem fim quando a persistencia falha

O `catch` de `attemptDelivery` nao persistia nada.

**Esta e uma correcao de uma analise minha.** Na primeira rodada eu refutei a
hipotese de starvation com o argumento de que `sendToGoogleChat` tem try/catch
total e nunca lanca. O argumento esta certo sobre o webhook e **incompleto**:
dentro do mesmo `try` existe outro `await` — o UPDATE que marca a entrega.

Cenario: o webhook ACEITA, a mensagem ja esta no canal corporativo, e o UPDATE
falha por erro transitorio do Postgres. Nada era persistido; a linha seguia com
`sent_to_chat = false` e `delivery_attempts = 0`; e a passada seguinte **postava
a mesma mensagem de novo** — a cada 5 minutos pelas 24h da janela, sem nunca
alcancar o teto.

Marcar entrega antes do envio nao era alternativa: seria afirmar entrega que
pode nao acontecer, o mesmo defeito do `MAIL_DRY_RUN`. O bloco de sucesso ganhou
try/catch proprio e debita a tentativa, de modo que o teto passa a limitar a
duplicacao. O catch externo usa uma flag `transportAttempted` para separar falha
ANTES do transporte (problema de banco — nao debita, porque cinco blips do
Postgres nao podem silenciar um alerta) de falha DEPOIS.

#### D-07 (MEDIA) — passadas sobrepostas entregam duas vezes

`node-cron` nao serializa execucoes. Com lote de 25 e timeout de 10s por chamada
ao webhook, o pior caso e ~250s contra os 300s do intervalo. Duas passadas
simultaneas leem a MESMA linha, porque o SELECT nao tem `FOR UPDATE`/`SKIP
LOCKED` e `sent_to_chat` so muda depois do POST.

O repositorio ja tinha os dois remedios para este problema: `email-check.ts`
(mesma cadencia) usa latch `isRunning`, e `modules/sydle/service.ts` usa
`pg_try_advisory_xact_lock`. O job novo nao tinha nenhum. Adotado o latch, que e
o idioma do vizinho de mesma cadencia e cobre a topologia atual de uma
instancia. Se a API passar a ter replicas, cada uma tera seu proprio scheduler e
o latch em memoria deixa de bastar — ai o caminho e o advisory lock. Registrado
aqui para nao ser redescoberto.

Um dos testes novos existe so para o `finally`: sem ele, o job travaria para
sempre depois do primeiro erro.

### Observado e nao resolvido

**Flake no E2E da API.** Numa das cinco execucoes, o caso
`dashboard-event-dates.e2e.test.ts > Reabertura de processo — ponta a ponta >
admin reabre um processo concluido com motivo e a trilha registra tudo` falhou.
As quatro execucoes seguintes passaram 63/63. A falha ocorreu com a maquina sob
carga do Playwright. Nao reproduzido e nao diagnosticado — registrado com o nome
exato para que a proxima ocorrencia nao comece do zero. **Nao tratar como
resolvido.**

### Nota final de metodo

Os sete defeitos desta revisao foram encontrados por dois caminhos, e nenhum
deles foi "reler o codigo procurando erro":

1. **Medir o sistema rodando** (D-01, D-02, E-01). O banco de producao respondeu
   perguntas que nenhum teste faz.
2. **Revisao adversarial com hipotese escrita antes da evidencia** (D-05 a D-07),
   incluindo a disciplina de escrever um teste que AFIRMA o comportamento errado
   de hoje: se ele passa, o defeito existe; quando passa a falhar, foi corrigido.

E o achado mais desconfortavel: **duas das minhas proprias conclusoes estavam
erradas** e foram corrigidas dentro da mesma sessao — a refutacao incompleta da
starvation (D-06) e a redacao de caminho que vazava com aparencia de tratada
(D-03). Revisar a propria entrega depois de verde continua achando defeito real,
toda vez.

### Terceira rodada — o que o time de revisao trouxe

Os relatorios chegaram depois do deploy de `3b5dd6f`. Dois achados novos, ambos
CONFIRMADOS por execucao pelo proprio revisor, mais o inventario de filtros.

#### D-08 (ALTA) — a queda do rate limiter para memoria era silenciosa

`apps/api/src/shared/cache/redis.ts`

`RedisCache.incr` tinha um `catch` **nu**. Qualquer erro do Redis ali faz o
contador cair para `MemoryCache`, que **recomeca do 1** — num limitador de
login, e a protecao contra forca bruta desaparecendo sem que ninguem saiba.

Havia **dois** fallbacks em memoria, e o que efetivamente rodava era justamente
o que nao avisava. O `logger.warn('Rate limiter cache error...')` escrito para
este caso mora no catch do middleware e e **inalcancavel**: o catch do `incr`
engole tudo, e `MemoryCache.incr` e logica sincrona que nao lanca.

Prova do revisor, contra um Redis 7 real: chave gravada com uma string JSON no
formato da versao anterior (para forcar o erro do `INCR`), duas chamadas
seguidas devolveram `count` 1 e 2 onde deveriam ser 6 e 7, o valor envenenado
ficou intacto ate o TTL vencer, e **zero linhas de log**.

Correcao: aviso de dentro do `incr`, com janela de silencio de 60s (sem ela, uma
queda do Redis viraria uma linha por requisicao — o mesmo problema de spam que
levou ao circuit breaker do Chat). So o BUCKET vai para o log, nunca o
identificador, que e o id do usuario ou o IP do cliente.

#### D-09 (ALTA para o usuario) — quatro telas tratavam uma fatia como o conjunto

Inventario completo do revisor de frontend: das 20 telas com controle de filtro,
**16 tem a cadeia completa** verificada de ponta a ponta (estado do componente →
queryKey → query string → uso real no schema/controller da API). As outras
quatro nao quebravam no filtro, e sim no CONJUNTO sobre o qual ele opera. Com a
base em ~117 processos:

| tela                | defeito                                      | efeito                                                           |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `currency-exchange` | `/api/processes` **sem `limit`**, default 20 | seletor MORTO do 21o processo em diante                          |
| `desembaraco`       | `limit=100`, sem paginacao                   | filtro cego alem de 100 e **cartoes somando a fatia como total** |
| `numerario`         | idem                                         | idem, no `totalNumerario`                                        |
| `follow-up`         | pedia `limit=200`, controller corta em 100   | no maximo 100 linhas, em silencio                                |

As quatro rotas ja devolviam `sendPaginated`, entao um unico hook
(`useAllPagesQuery`) resolve as quatro percorrendo a paginacao ate o fim. Sem UI
nova e sem endpoint novo: o que existia passou a funcionar.

O teto de 20 paginas do hook e trava contra laco infinito, e nao pode virar uma
NOVA fatia silenciosa — que e o defeito que este trabalho corrige. Por isso o
hook devolve `truncated` e as duas telas que exibem totais dizem, quando ele e
atingido, que os numeros somam apenas a fatia carregada.

#### Confirmado por execucao e por isso NAO alterado

- **Migracoes 0027/0028 sao idempotentes de verdade.** O revisor rodou o runner
  de producao (`migrate.ts`, o mesmo que o deploy executa) **duas vezes seguidas**
  contra um Postgres 16 descartavel. Ambas exit 0; a segunda so emitiu
  `NOTICE ... already exists, skipping`. Estado final conferido por query, nao
  por log: 3 colunas novas em `alerts`, 3 em `process_items`, o indice parcial e
  a FK com `DO $$` — todos presentes uma unica vez.
- **O rate limiter e fixed window de verdade** (o `EXPIRE` so no primeiro
  incremento), `Retry-After` bate com o TTL real medido no servidor, e queda de
  conexao no meio da janela nao reseta o contador nem derruba a rota.
- **A troca de `req.path` por `req.baseUrl + req.path` nao gerou colisao de
  chave.** Os 17 limitadores estao todos dentro de routers montados, nenhum com
  `baseUrl` vazio. A hipotese de "chave antiga com tipo errado sobrevivendo ao
  deploy" nao se aplica a este deploy.
- **F1 do revisor de runtime ja estava coberto.** Ele reportou que
  `alertService.create()` continuava furando teto e backoff no HEAD, tendo
  verificado `service.ts` — que de fato nao mudou. A guarda passou para
  `delivery.service.ts`, dentro do `attemptDelivery`. Verificado com teste: um
  duplicado com 99 tentativas e carimbo de agora nao faz nenhuma chamada ao
  webhook e nenhum UPDATE. **E precisamente o argumento a favor de por a regra no
  ponto de decisao e nao no chamador**: a correcao vale para um chamador que o
  revisor nem inspecionou.

### Quarta rodada — os relatorios completos dos revisores

Chegaram os dois relatorios que faltavam. Trouxeram o achado mais grave da
sessao inteira e um levantamento de fuso que atinge numeros que o operador le
na tela todos os dias.

#### D-10 (CRITICA) — um arquivo de 4,7 MB derruba a API inteira

`apps/api/src/modules/documents/service.ts`

Medido pelo revisor: um `.xlsx` **valido** de 4,7 MB com 3 colunas x 400 mil
linhas descomprime para 127 MB de XML e leva o RSS a **770 MB** so no
`XLSX.read`. O container tem `memory: 512M` e os workers do pg-boss rodam
**dentro** do processo da API — nao ha container de worker no compose. O alvo do
OOM nao e um job: e a API.

Nenhum caminho de entrada exige admin. Qualquer pessoa com escrita numa pasta de
processo no Shared Drive (o sweep ingere, e xlsx passa no magic-byte check porque
xlsx **e** zip); qualquer analista autenticado via
`POST /api/communications/drive/import`; e `POST /api/ai/extract`, que chama a
extracao **dentro da request HTTP** a 30 req/min — OOM-kill repetivel.

O teto de `maxChars` que ja existia nao ajuda: protege o tamanho do PROMPT e so
age depois que o parser terminou de alocar.

Correcao: xlsx e docx sao ZIP, e o indice do ZIP declara o tamanho descomprimido
de cada entrada. Da para decidir **sem descomprimir um byte** e sem dependencia
nova. Limites de 64 MB descomprimidos e razao de 200x — os dois juntos, porque o
arquivo medido expande so 27x: o teto absoluto pega este caso, a razao pega a
bomba classica de arquivo minusculo. ZIP64 e recusado.

#### D-11 (ALTA) — decisoes de calendario no fuso do container

Levantamento do revisor de dados, **reproduzido por mim** contra um Postgres 16
em UTC. Quatro classes, todas de um dia, todas nas tres horas entre 21:00 e
meia-noite no Brasil — todos os dias:

| onde                          | efeito                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| "dias restantes" da LI        | prazo de **amanha** reportado como `0`, indistinguivel de "vence hoje" |
| janela de proximos pagamentos | o vencido de ontem some, e entra um dia a mais na outra ponta          |
| "processo atrasado"           | dispara **27h** antes da hora                                          |
| grafico por mes               | processo criado as 22h do dia 31 conta no mes seguinte                 |

```
 prazo LI  | antigo | novo      vencimento | antigo | novo
-----------+--------+------    ------------+--------+------
 29/08     |   0    |  0        28/08      |   f    |  t
 30/08     |   0    |  1        05/09      |   t    |  t
 31/08     |   1    |  2        06/09      |   t    |  f
```

`EXTRACT(DAY FROM prazo - now())` descarta o dia **parcial**. E
`::date + interval '13 days' < now()` compara contra o **inicio** do dia do prazo.

O agrupamento por mes precisa das **duas** conversoes, e a ordem importa: em
`timestamp` sem fuso, `AT TIME ZONE 'America/Sao_Paulo'` **interpreta** o valor
como se ja fosse local — o oposto do desejado.

Tambem corrigidos `sydle/normalizer.ts` (gravava `overdue` tres horas antes de o
dia acabar para quem paga), os tres nomes de arquivo exportado do SYDLE, e o
ultimo `CURRENT_DATE` do `apps/api/src`. `executive.service.ts` ja usava o padrao
correto — `dashboard`, `sydle` e `follow-up` eram os retardatarios.

#### D-12 (MEDIA) — a primeira redacao deixou tres lacunas

O revisor re-rodou a sonda pelos controllers **depois** da correcao. A mais
constrangedora: o incidente citado no comentario da propria funcao continuava
vazando. O `DATABASE_URL` conecta pelo **nome** do servico do compose, entao a
mensagem real e `getaddrinfo ENOTFOUND postgres` — e um padrao de IPv4 nao ve
nome nenhum. O padrao novo ancora no **errno**, e nao numa lista de servicos, de
modo que servico novo do compose ja nasce coberto.

### Divida registrada, nao corrigida

- **79 outros `Number(req.params.X)` sem guarda, em 12 controllers.** O vazamento
  esta fechado para todos pela redacao; o que falta e devolver `400 id invalido`
  em vez de erro de banco. O repositorio ja tem o idioma — `validate(schema,
'params')`, usado em 14 rotas. 79 pontos e desproporcional a um turno, e o
  risco de seguranca ja esta contido.
- **`mammoth.extractRawText`** recebeu a mesma guarda de arquivo por simetria de
  formato (docx tambem e ZIP), mas o consumo dele **nao foi medido** como o do
  SheetJS.
- **Injecao de prompt**: as sondas mostraram que homoglifo fullwidth e angulos
  espacados sobrevivem ao saneamento. Falta o veredito de exploracao real — se o
  modelo de fato obedece a um delimitador forjado. **Nao tratar como resolvido
  nem como refutado.**

### Quinta rodada — revisao da quarta rodada, ja em producao

A quarta rodada foi implantada como `6548379` as 19:38 e nunca passou por
revisao independente: as tres correcoes (`70a4e5d`, `1c4ab36`, `50e48e5`) foram
escritas em resposta aos relatorios dos revisores, e ninguem revisou a resposta.
Esta secao e essa revisao. Ela achou dois defeitos na propria correcao de D-10,
o achado mais grave da sessao anterior.

Estado de partida verificado antes de tocar em qualquer coisa: producao saudavel
em `/health/live` com `revision: 6548379ae893...` — o SHA do HEAD, o que tambem
fecha E-01 na pratica (o health passou a dizer o que roda). Gate local em
`6548379`: `format:check`, `lint`, `typecheck` e `npm test` todos exit 0.

#### D-13 (CRITICA) — a guarda de bomba cobria UM dos tres caminhos ate o parser

`apps/api/src/modules/espelho-parser/parser.ts`, `apps/api/src/modules/pre-cons/service.ts`

A correcao de D-10 instalou `assertArquivoSeguroParaAbrir` em
`spreadsheetBufferToText` e no ramo docx. A pergunta que ficou sem resposta e a
que importa: **`spreadsheetBufferToText` e o unico caminho ate `XLSX.read`?**

Nao e. Um `grep` por `XLSX.read` devolve tres. Os outros dois:

| caminho              | como se chega                                                                                                                          | quem dispara                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `parseEspelhoBuffer` | `processWithAIClaimed` desvia para o parser deterministico quando `type === 'espelho'` e **nunca** passa por `spreadsheetBufferToText` | worker do pg-boss, automatico                                          |
| `parsePreConsXLSX`   | `POST /api/pre-cons/sync` (upload de ate 20 MB) e `POST /api/pre-cons/sync-from-drive`                                                 | admin; no caminho do Drive o CONTEUDO vem de quem tem escrita na pasta |

O primeiro e o mais grave, e por um motivo quase comico: espelho **e**, por
definicao, um xlsx. O caminho mais provavel de uma planilha entrar no sistema foi
exatamente o que ficou de fora — e ele roda sozinho, dentro do processo da API.

Provado por execucao antes de corrigir, com teste que afirma o comportamento de
hoje: `bomba-planilha-caminhos.test.ts` alimentou os dois com o indice do arquivo
de 4,7 MB / 127 MB medido em D-10 e falhou com
`Bad compressed size: 4928307 != 858980352` — mensagem de dentro do SheetJS, ou
seja, o parser foi **alcancado**. Depois da correcao, 4/4 passam e `XLSX.read`
nao e chamado.

A guarda ficou dentro das duas funcoes de parse, e nao nos chamadores, pelo
mesmo argumento que valeu em D-05: no ponto de decisao ela cobre tambem o
chamador que ninguem inspecionou.

#### D-14 (ALTA) — a guarda acreditava no indice, e o indice e dado do atacante

`apps/api/src/shared/utils/archive-guard.ts`

A guarda decidia lendo os tamanhos **declarados** no central directory. Declaracao
nao e medicao.

Provado por execucao: peguei um xlsx legitimo, reescrevi para `1000` os campos de
tamanho descomprimido do indice e dos cabecalhos locais, e chamei a guarda com
teto de **64 KB** e razao maxima de **2x**. Ela passou. `XLSX.read` inflou
**77,8 MB** logo em seguida.

A causa esta visivel no SheetJS: com zlib nativo — o caso no Node —
`_inflateRawSync` ignora o tamanho declarado e infla o stream inteiro. A
comparacao `_usz != usz`, que produz `Bad uncompressed size`, roda **depois** da
alocacao. O arquivo diz o que quiser; o parser aloca o que existe.

Correcao: depois das checagens por declaracao (baratas, e que recusam o arquivo
grande honesto sem alocar nada), a guarda agora **mede**. Percorre os cabecalhos
locais e infla com `maxOutputLength` igual ao orcamento restante, de modo que o
pior caso alocado e o proprio orcamento — nunca o tamanho do ataque.
`Z_SYNC_FLUSH` porque cada entrada e seguida das demais no mesmo buffer.

A primeira tentativa de correcao cobriu so o deflate e **o bypass continuou
aberto**, porque o `XLSX.write` do proprio SheetJS grava ARMAZENADO: para metodo
0 o que vale e o `_csz` do cabecalho local, nao o tamanho descomprimido do
indice. Os dois metodos tem caso proprio no teste por causa disso.

Uma distincao que o teste ensinou e que vale registrar: **mentir no tamanho
COMPRIMIDO nao e ataque.** Em entrada armazenada o SheetJS le exatamente `_csz`
bytes, entao encolher o campo encolhe o que ele carrega — o arquivo quebra por
formato, nao por memoria. Em deflate o campo e ignorado. O unico campo que
engana e o descomprimido.

Custo medido no pior caso honesto que existe na empresa — a planilha
`1_Follow Up Processos de Importação.xlsx`, 23 MB, 22 abas, 387 entradas:

```
forjado, teto de 8 MB   -> recusado em    21 ms  (zlib aborta ao estourar)
honesto, teto de 512 MB -> aceito   em   296 ms  (verificou 234,5 MB de verdade)
```

#### D-15 — a correcao de D-14 nasceu com um furo, achado revisando a propria correcao

Depois de D-14 ficar verde, reli o codigo que eu tinha acabado de escrever. O
tratamento de erro da verificacao usava `return`, e nao `continue`: um stream
corrompido em qualquer entrada **abandonava o arquivo inteiro**. Bastava por uma
entrada quebrada ANTES da bomba para desligar a checagem de todas as seguintes.

Provado invertendo a correcao: com `return`, o teste falha com
`expected [Function] to throw an error` — a bomba passa. Com `continue`, passa.
O teste pega o defeito que foi escrito para pegar, o que e a unica evidencia que
vale para uma guarda.

Era defensavel argumentar que o SheetJS tambem quebraria na entrada corrompida
antes de chegar a bomba, por percorrer o indice na mesma ordem. Mas isso e um
argumento sobre ordem de iteracao de uma biblioteca de terceiros, e a versao
segura nao custa nada: seguir para a proxima entrada.

Terceira vez nesta sessao em que revisar a propria entrega **depois de verde**
achou defeito real.

#### O teto de 64 MB: minha hipotese estava errada, e a medicao derrubou

Entrei nesta rodada convencido de que 64 MB era generoso demais. Extrapolando o
numero de D-10 (127 MB -> 770 MB de RSS) contra um container de 512M com 85 MB
de linha de base, 64 MB dariam ~390 MB de RSS — apertado. Ia baixar o padrao.

A medicao disse outra coisa. Os dados reais de producao:

| o que                                     | valor                    |
| ----------------------------------------- | ------------------------ |
| maior planilha na tabela `documents`      | **218 KB** (um espelho)  |
| media dos espelhos                        | 103 KB                   |
| maiores xlsx do Pre-Cons ja sincronizados | ~11 KB de linhas, 5 abas |
| RSS da API em producao, em repouso        | **84,6 MiB de 512 MiB**  |

E o unico arquivo grande de verdade, o Follow Up de 23 MB, declara 234,5 MB
descomprimidos e custa **+776 MB de RSS** e 7,1 s no `XLSX.read`. Ou seja: o teto
de 64 MB **ja recusa** esse arquivo, e recusa certo — ele nao cabe no container.
Baixar o teto so passaria a recusar mais coisa sem beneficio, e subir causaria o
OOM que a guarda existe para evitar. **O numero fica como esta.**

Registro isso porque a conclusao contraria a hipotese com que comecei, e porque o
caminho que a corrigiu foi medir producao em vez de extrapolar de um unico ponto.

#### Confirmado por execucao e por isso NAO alterado

- **O fuso de D-11 esta correto contra o banco de producao.** Verificado no
  proprio Postgres de producao, e nao so em container de teste: `TimeZone = UTC`,
  `America/Sao_Paulo` existe no tzdata (sem ele toda consulta corrigida teria
  virado erro), e a diferenca aparece exatamente onde deveria — as 00:30 e as
  02:59 UTC o container ja diz 30/08 enquanto o calendario do operador ainda diz
  29/08; as 03:01 UTC os dois concordam.
- **`sqlLocalDeUtc` esta certo para a coluna em que e usado.**
  `import_processes.created_at` e `timestamp` SEM fuso (`schema.ts:152`), que e a
  premissa da dupla conversao. Se a coluna fosse `timestamptz` a mesma expressao
  deslocaria o valor no sentido errado — e o schema tem 26 colunas `withTimezone`.
  A funcao esta correta hoje; o que ela nao tem e uma guarda contra ser aplicada
  a uma coluna do outro tipo.
- **Nenhum erro de SQL em producao desde o deploy.** Em 90 minutos de log ha 8
  linhas de erro, todas a mesma: a chave do webhook do Google Chat invalida. As
  consultas com `sql.raw` do fuso respondem sem erro.

#### Estado do canal de alerta, medido agora

| metrica                  | 19:38 (deploy) | 20:05 |
| ------------------------ | -------------- | ----- |
| total                    | 5.067          | 5.067 |
| entregues                | 0              | **0** |
| com tentativa registrada | 3              | 9     |
| criados nas ultimas 24h  | 28             | 28    |

O job de reentrega esta vivo e o backoff funciona — 9 tentativas consumidas em
horas, e nao 5.067. Continua faltando **rotacionar a chave do webhook**, que e
segredo e depende do usuario. Nada disso e novo; e a confirmacao de que o
desenho implantado se comporta como projetado enquanto a pendencia nao e
resolvida.

#### Divida registrada nesta rodada, nao corrigida

- **A verificacao real nao e consciente de concorrencia.** O orcamento e por
  arquivo. Ha tres filas com `batchSize: 1` (`drive-sync`, `sheets-sync`,
  `ai-extraction`) mais os caminhos HTTP sincronos, e todas rodam **dentro** do
  processo da API. Dois parses simultaneos no teto pagam o teto duas vezes. Na
  pratica o risco e baixo porque a maior planilha real tem 218 KB, mas o limite e
  por arquivo e nao global — registrar para nao ser redescoberto.
- **`mammoth.extractRawText` continua sem medicao.** A guarda vale para ele por
  simetria de formato (docx tambem e ZIP), e agora tambem a verificacao real, mas
  o consumo do mammoth nunca foi medido como o do SheetJS foi.
- **`sqlLocalDeUtc` recebe o nome da coluna como string crua.** Funciona hoje e
  esta verificado, mas um alias na consulta quebraria em runtime, nao em
  compilacao.

#### Gate final da quinta rodada — saida real

```text
npm run format      -> exit 0
npm run lint        -> exit 0
npm run typecheck   -> exit 0
npm test            -> API 1543 passed | 1 skipped   web 231 passed   exit 0
npm run build       -> exit 0
npm run test:e2e -w apps/api -> 8 arquivos, 63/63 passed
npm run test:e2e:web         -> 82/82 passed (2,6 min)
```

O E2E da API passou 63/63 **incluindo** `dashboard-event-dates.e2e.test.ts`, o
caso que falhou uma vez na rodada anterior. Uma passagem nao refuta um flake:
continua registrado como observado e nao diagnosticado.

Comparado com o baseline da quarta rodada (API 1.494 testes), esta rodada
adicionou 8: 4 em `bomba-planilha-caminhos.test.ts` (os dois caminhos ate o
parser que estavam descobertos, mais as duas contraprovas de que o caminho
legitimo continua chegando ao `XLSX.read`) e 4 em `archive-guard.test.ts` (os
dois metodos de compactacao com indice adulterado, a entrada corrompida no
comeco, e a planilha honesta que tem de continuar passando).

### Deploy da quinta rodada — 2026-08-29, 20:34

Autorizado explicitamente pelo usuario, em duas perguntas separadas: o deploy e,
depois, o push — porque `scripts/deploy.sh:93` exige `HEAD == origin/master` e o
push e operacao propria, com regra propria no `AGENTS.md`. `master` estava dois
commits a frente.

```text
push origin master           -> 6548379..c769d57
[1/8] backup obrigatorio     -> pgdump 2,5M, integridade verificada por
                                pg_restore --list, + volume uploads
      snapshot para rollback -> /home/nicolas/importacao.rollback
[2/8] rsync                  -> ok
[3/8] sops                   -> gate SYDLE liberado por ALLOW_SYDLE_SYNC_DEPLOY=1
[4/8] alertmanager           -> renderizado
[5/8] compose remoto         -> valido; rede ia-local-net existe
[6/8] migrations             -> aplicadas ("Found 18 forward-only SQL migrations")
[7/8] build api+web+cert-api -> containers recriados (log anterior arquivado)
[8/8] health                 -> api, cert-api, web e proxy /api: todos OK
exit 0, sem rollback
```

#### O que a producao provou

`/health/live` responde `revision: c769d57c1c2e...` — o SHA exato do deploy.

E a verificacao que importa, porque "esta no git" nao e "esta rodando": o
artefato compilado **dentro do container** contem a correcao.

```text
dist/shared/utils/archive-guard.js       verificarTamanhoRealDescomprimido  2x
dist/modules/espelho-parser/parser.js    assertArquivoSeguroParaAbrir       2x
dist/modules/pre-cons/service.js         assertArquivoSeguroParaAbrir       2x
```

Duas ocorrencias em cada e o esperado: definicao mais chamada no primeiro,
import mais chamada nos outros dois. Os dois caminhos que D-13 encontrou
descobertos estao guardados no codigo que esta de fato em execucao.

Estado apos o deploy: zero linhas de erro no log da API, scheduler iniciado,
`Document ingestion source: email`, RSS da API em **75,5 MiB de 512 MiB**.

#### O que este deploy NAO resolve

Nada mudou nas pendencias que dependem de segredo ou de decisao de negocio. Em
particular, a chave do webhook do Google Chat continua invalida e os 5.067
alertas continuam com **zero entregues** — o job de reentrega esta vivo e o
backoff funciona (9 tentativas consumidas, nao 5.067), entao os alertas das
ultimas 24h saem sozinhos no momento em que a chave for rotacionada.

---

## Sexta rodada — fechar a divida registrada, e o que ela escondia

Esta rodada nao procurou defeito novo: foi atras das pendencias que as rodadas
anteriores registraram e adiaram. Tres foram fechadas, e duas delas revelaram
problemas maiores do que o registro dizia.

### P-A — 81 conversoes `Number(req.params.X)` sem guarda

Registrada como "desproporcional a um turno". Era, do jeito como estava sendo
contada. Reformulada, virou pequena.

O levantamento anterior contou CONVERSOES no controller (81, em 12 arquivos). Mas
`auth/controller.ts` faz a mesma coisa escrita de outro jeito —
`const { id } = req.params` e `Number(id)` depois — e por isso **escapou do
levantamento**. Prova de que a invariante nao pode depender de como o controller
escreve a conversao.

A invariante certa e o NOME do parametro na rota: `id` e `<coisa>Id` sao
numericos; `processCode` e `key` nao sao. Contadas assim, sao **66 rotas** em 10
modulos — e a correcao e declarativa, no idioma que o repositorio ja tinha
(`validate(schema, 'params')`, ja usado em 14 rotas).

O que foi entregue:

- `shared/schemas/params.ts` com `paramsNumericos(...)`, um helper unico em vez
  de dez schemas duplicados;
- `params-de-rota.test.ts`, **guarda estatica** que varre os arquivos de rota e
  falha quando uma rota com parametro numerico nasce sem validacao — o defeito e
  a AUSENCIA de uma declaracao, e nenhum teste de requisicao cobre uma rota que
  ninguem lembrou de escrever. Inclui contraprova: se o parser quebrar, o teste
  falha em vez de passar por vacuidade;
- `params-invalidos.e2e.test.ts`, contra Postgres real, provando o 400 e que
  nenhuma resposta carrega vocabulario de driver.

**Duas armadilhas encontradas ao escrever, ambas provadas por execucao:**

1. **`z.object` APAGARIA os parametros nao declarados.** `validate` faz
   `req.params = result.data`, e o `strip` padrao do Zod remove o que nao esta no
   schema. Numa rota como `/:id/custom-stages/:stageId`, declarar so um deles
   removeria o outro — trocando um erro de validacao por um bug MUDO, que e o
   oposto do objetivo. Resolvido com `passthrough()`, com teste dedicado.
2. **A mensagem de erro saia em ingles.** Escrita so no `.positive()`, ela nunca
   aparecia: `abc` falha antes, na checagem de tipo, e o operador recebia
   `Expected number, received nan`. Foi o meu proprio teste E2E que pegou —
   e e exatamente o defeito ja corrigido nesta base (entrada invalida
   respondendo com mensagem interna em ingles). A mensagem passou a estar nos
   tres niveis.

### P-B — `mammoth` sem medicao: o teto herdado estava errado por ~5x

Registrada como "a protecao aqui e por simetria de formato, nao por medicao".
Medida agora, a simetria se mostrou **insegura**.

`mammoth.extractRawText`, contra docx sinteticos:

| descomprimido | RSS      | razao |
| ------------- | -------- | ----- |
| 7,9 MB        | 266 MB   | 33,7x |
| 31,6 MB       | 563 MB   | 17,8x |
| 94,9 MB       | 1.400 MB | 14,8x |

Contra ~3,3x do SheetJS. A consequencia e concreta: **um docx de 580 KB que
expande para 31,6 MB consome 563 MB — mais do que o container inteiro tem — e
passava FOLGADO no teto de 64 MB herdado do xlsx.**

Teto proprio de 12 MB (`MAX_DESCOMPRIMIDO_DOCX_PADRAO`), que a ~20x deixa o pior
caso em ~250 MB sobre uma linha de base medida de 84,6 MiB. Nao aperta nada real:
o maior docx do repositorio expande para 3,7 MB e a tabela `documents` de
producao **nao tem nenhum docx**.

### P-C — `sqlLocalDeUtc` recebia o nome da coluna como string

Registrada como "falta a guarda de tipo". Deu para fazer melhor que uma guarda
estatica: o Drizzle expoe `columnType`, `withTimezone` e o nome da tabela em
runtime, entao a funcao passou a receber a COLUNA e montar a referencia sozinha
— e a recusar coluna `timestamptz`, onde a dupla conversao deslocaria o valor no
sentido oposto, em silencio. O schema tem 26 colunas com fuso.

### O flake do E2E tinha causa, e nao era carga

Registrado como "nao reproduzido e nao diagnosticado". A carga era o gatilho, nao
a causa.

Em `processService`, o `recordProcessEvent` da mudanca de status e aguardado, com
comentario explicando por que — "a resposta 200 nao pode sair antes de a trilha
existir". O `auditService.log` logo acima **nao era**. E o teste que falhava
consultava `audit_logs` — a escrita nao aguardada.

Nao e so problema de teste. Numa REABERTURA — restrita a admin, cuja razao de
existir e a justificativa registrada — devolver 200 afirmando que a operacao foi
auditada enquanto a linha ainda nao caiu no banco e a mesma classe de defeito ja
registrada aqui: o sistema afirmando um registro que pode nao ter acontecido.

Corrigido com `await`, e congelado por teste DETERMINISTICO (o dublê so conclui
depois de um tick). Verificado invertendo a correcao: sem o `await` o teste falha
sempre, com `expected false to be true`. **O flake virou regressao detectavel.**

### O achado que nao estava em nenhuma lista

Ao ligar os botoes da nova guarda no compose, descobri que os botoes da guarda
ANTERIOR tambem nao estavam la. O servico `api` do `docker-compose.prod.yml` usa
lista explicita de `environment:`: so chega ao container o que estiver listado.

Comparando `process.env.X` do codigo com o bloco `api`: **38 variaveis lidas e
nao repassadas.** E uma delas esta **definida no `.env` de producao**:
`AI_DAILY_BUDGET_BRL`, o teto diario de custo de IA — cujo proprio alerta de 80%
instrui o operador a "ajustar AI_DAILY_BUDGET_BRL", coisa que nao fazia nada.

E ai a armadilha, que quase levei ao compose: **repassar com `${VAR:-}` teria
DESLIGADO o teto.** O compose passa string VAZIA, e a leitura usa
`Number(process.env.X ?? '100')` — `??` nao trata string vazia, entao
`Number('')` e `0`, e `0` desativa a verificacao. Confirmado por execucao:
`''` -> teto inativo; `undefined` -> teto de R$ 100 ativo.

Por isso as duas variaveis de IA foram ligadas com os **defaults do proprio
codigo** (`:-100`, `:-5`). Conferido antes, sem imprimir valor: o valor no `.env`
de producao **e igual ao default**, entao ligar isto nao muda o comportamento de
hoje — so faz o botao passar a existir de verdade.

A guarda de arquivo, ao contrario, e imune: `numeroPositivoDoAmbiente` trata
`''` como ausente, e ja havia teste para isso.

As outras 36 ficaram registradas em `TECH_DEBT.md` com a reproducao, e nao
corrigidas em lote: repassar as-is pode ligar um valor obsoleto do `.env` sobre
um default melhor do codigo. Duas ressalvas medidas para nao inflar o numero —
`REVISION` e fallback morto e documentado, e `METRICS_TOKEN`/`METRICS_ALLOWED_IPS`
so afrouxam o acesso a `/metrics`, entao a ausencia falha fechado.

### Gate final da sexta rodada — saida real

```text
npm run format               -> exit 0
npm run lint                 -> exit 0
npm run typecheck            -> exit 0
npm test                     -> API 1555 passed | 1 skipped   web 231 passed
npm run build                -> exit 0
npm run test:e2e -w apps/api -> 9 arquivos, 73/73 passed
npm run test:e2e:web         -> 82/82 passed (2,7 min)
```

`docker compose -f docker-compose.prod.yml config` falha LOCALMENTE por falta dos
segredos (`GRAFANA_ADMIN_PASSWORD`, `CERT_API_KEY`), e falha igual no HEAD sem as
minhas alteracoes — e ambiental, nao regressao. A validacao real do compose
acontece no host remoto, na etapa 5/8 do deploy. Aqui o YAML foi conferido por
parser, com as chaves novas no servico `api` e os defaults corretos.

Verificacao de risco antes de publicar: `z.coerce` troca `req.params` por
NUMERO em runtime. Varridos os usos dos parametros numericos que nao passam por
`Number(...)`, sobrou um so — uma interpolacao em template literal
(`documento-${req.params.id}`), que funciona igual. `processCode` e `key`
continuam string, preservados pelo `passthrough`.

Contagem de testes desde a quinta rodada: API 1543 -> 1555 (+12), E2E da API
63 -> 73 (+10).

### Deploy da sexta rodada — 2026-08-29, 21:26

`scripts/deploy.sh`, 8/8, exit 0, sem rollback. SHA `75f91474bb34`.

A etapa 5/8 — `Remote compose config valid` — validou o compose **no host
remoto, com os segredos reais**, o que fecha a lacuna da validacao local (que
falha por falta de `GRAFANA_ADMIN_PASSWORD` e `CERT_API_KEY`, no HEAD tambem).

#### O que a producao provou

`/health/live` responde `revision: 75f91474bb34...`, o SHA exato.

Os botoes agora CHEGAM ao container — que era o ponto do achado:

```text
AI_DAILY_BUDGET_BRL=100          <- valor efetivo, igual ao default do codigo
AI_BRL_PER_USD=5                 <- idem: ligar isto nao mudou comportamento
DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES=        (vazio -> default do codigo)
DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES=   (vazio -> default do codigo)
DOCUMENT_ARCHIVE_MAX_RATIO=                     (vazio -> default do codigo)
```

O vazio e seguro **so porque** `numeroPositivoDoAmbiente` trata `''` como
ausente. Fosse a leitura com `??`, como a do teto de custo, o vazio viraria `0` e
desligaria a guarda — que e exatamente por que as duas variaveis de IA foram
ligadas com default explicito.

E o codigo novo esta no artefato que roda, nao so no git:

```text
dist/modules/*/routes.js          paramsNumericos em 10 arquivos (os 10 modulos)
dist/shared/utils/archive-guard.js  MAX_DESCOMPRIMIDO_DOCX_PADRAO  2x
dist/modules/processes/service.js   await auditService.log         8x (era 7)
```

Zero erros no log desde o deploy. RSS da API: 75,9 MiB de 512 MiB.

#### Continua aberto, sem mudanca

- **Chave do webhook do Google Chat.** 5.067 alertas, zero entregues. Depende de
  segredo.
- **Injecao de prompt**: homoglifo fullwidth e angulos espacados sobrevivem ao
  saneamento; falta o veredito de exploracao real (se o modelo obedece a um
  delimitador forjado). Exigiria chamada paga ao provider — nao executado.
  **Nao tratar como resolvido nem como refutado.**
- **36 variaveis lidas e nao repassadas** pelo compose, e a leitura com `??` que
  trata string vazia como valor. Ambas em `TECH_DEBT.md`, com reproducao.
- **Guarda de arquivo nao consciente de concorrencia** — o orcamento e por
  arquivo, e tres filas mais os caminhos HTTP rodam no mesmo processo.
- As decisoes de negocio (P-01 a P-06) e o reprocessamento documental.

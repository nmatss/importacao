# Status — Os Tres Pedidos Da Eduarda Na Importacao — 2026-08-17

> **Atualização de 28/08/2026:** o comportamento conservador descrito neste
> checkpoint foi substituído pelo contrato fail-closed solicitado pela operação.
> `DOCUMENT_SOURCE=drive` e `PROCESS_REFERENCE_SOURCE=follow_up` agora são os
> padrões; ausência do Follow Up bloqueia vínculo/criação/ingestão, upload manual
> é bloqueado em modo Drive-only e a varredura ignora processos fora da planilha.
> Fonte atual: `docs/operations/document-intake-contract-2026-08-28.md`.

## Objetivo

Atender o relato da Eduarda (WhatsApp, 17/08/2026), que pediu foco em tres
pontos para o time conseguir comecar a usar a parte documental antes do pico de
volume:

1. "o sistema ainda nao consegue ler os documentos completos, a maioria dos
   campos esta trazendo so um `-`";
2. "pegar as referencias de processo somente que estao na planilha Follow Up,
   porque tem pego outras informacoes (codigo de itens, referencias
   incompletas)";
3. "eu ficaria mais segura se agora no inicio considerasse so o que incluimos na
   pasta do processo no drive mesmo".

Ela mesma marcou os pontos 2 e 3 como temporarios ("depois que tivermos mais
avancados, ajustamos a automacao de novo pra pegar do email"), por isso as duas
mudancas entraram atras de configuracao reversivel, nao como reescrita.

## Resultado

Codigo entregue e verde: `apps/api` **941** testes passando (baseline era 876),
`apps/web` 128, `apps/cert-api` 509, `tsc --noEmit` limpo em api e web, `eslint
--max-warnings=0` limpo, `ruff check` limpo, `npm run build` OK.

A causa-raiz das falhas de extracao (ponto 1) ganhou documento proprio:
`docs/STATUS-2026-08-17-CAUSA-RAIZ-FALHA-EXTRACAO.md`.

Na entrega original, as chaves preservavam o fluxo anterior. A atualização de
28/08 removeu esse fallback: o padrão agora é Follow Up + Drive e a ausência das
dependências bloqueia a ingestão em vez de aceitar uma fonte não autorizada.

## Ponto 2 — Referencias so da planilha Follow Up

### Diagnostico

O fluxo atual monta candidatos a codigo de processo por regex sobre assunto e
corpo do e-mail, aceita tambem um palpite da IA pelo mesmo filtro, e resolve
contra o banco em `fuzzyMatchProcessCode`
(`apps/api/src/modules/email-ingestion/processor.ts`). Duas coisas produziam o
lixo que ela relatou:

- **Referencia incompleta virava vinculo.** O terceiro estagio do match era
  `ilike('%CODE%')` com minimo de 7 caracteres normalizados. `PK2052602` e
  substring de `PK2052602TJ`, entao uma referencia truncada anexava o documento
  ao processo completo sem nenhum aviso.
- **Auto-criacao a partir do e-mail.** Codigo no formato forte Uni.co que nao
  existia no banco criava processo novo (`FOLLOW_UP_AUTO_CREATE` diferente de
  `0`), com a nota "Criado via follow-up — confirme referencia no Pre-Cons".
  Nada exigia que a planilha conhecesse aquela referencia.

### O que mudou

Novo `apps/api/src/modules/follow-up/reference-registry.ts`: a coluna A da
planilha Follow Up passa a ser a autoridade sobre o que e uma referencia valida.
Regex e IA continuam propondo; a planilha decide.

- Match **exato** sobre a forma normalizada (remove espaco, `-`, `_`, `.`, `/` e
  maiusculiza). O sufixo NAO e removido — e justamente ele que separa
  `PK2052602TJ` de `PK2052602NB`.
- Cache com TTL (`FOLLOW_UP_REFERENCE_TTL_MS`, padrao 10 min) e coalescencia de
  chamadas concorrentes, para o lote de e-mails nao virar uma chamada ao Sheets
  por mensagem.
- `googleSheetsService.readProcessReferences()` **lanca** em falha, ao contrario
  dos outros leitores da mesma classe que devolvem `[]`. "A planilha diz que nao
  tem processo" e "nao conseguimos ler a planilha" nunca podem colapsar na mesma
  resposta vazia — essa ambiguidade e o que deixou um incidente de integracao
  passar 12 dias sem ser notado em 08/2026.

Comportamento em falha, deliberadamente diferente por tipo de falha:

| Situacao                                                                          | Comportamento                                                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PROCESS_REFERENCE_SOURCE=legacy`                                                 | Fluxo antigo, inclusive match por substring.                                                                                              |
| Planilha **nao configurada** (sem `GOOGLE_SHEETS_FOLLOW_UP_ID` ou sem credencial) | Fail closed: nenhum vínculo, criação ou documento do Drive é ingerido. O health administrativo informa o bloqueio.                        |
| Planilha configurada e **fora do ar**, com cache                                  | Serve o ultimo cache bom, marcado como `stale`.                                                                                           |
| Planilha configurada e **fora do ar**, sem cache                                  | Fail closed em vínculo, criação e varredura do Drive. Um alerta orienta corrigir o acesso e reprocessar.                                  |
| Nenhum candidato consta na planilha                                               | Nada e vinculado nem criado, e um alerta nomeia os codigos recusados. Recusar em silencio repetiria o padrao de falha silenciosa da casa. |

Uma consequencia intencional: uma referencia que consta na planilha mas nao tem
o formato forte Uni.co (por exemplo `IMP-2025-001`) passa a poder criar processo.
O gate de formato existia para barrar palpite; algo que o time digitou na
planilha nao e palpite.

### Testes

`apps/api/src/modules/follow-up/__tests__/reference-registry.test.ts` — 21 casos,
incluindo os dois sintomas relatados: codigo de item (`PI7223Y`) rejeitado e
referencia truncada (`PK2052602`) rejeitada em vez de casar com `PK2052602TJ`.

### O Estrago Ja Presente Na Base (medido em producao, 17/08)

De 104 processos, **28 tem codigo fora do formato forte Uni.co** e **11 foram
criados automaticamente a partir de e-mail**. Os dois conjuntos se cruzam
exatamente onde a Eduarda apontou:

| Codigo                             |        Documentos | Origem                 | O que e de fato                                                                        |
| ---------------------------------- | ----------------: | ---------------------- | -------------------------------------------------------------------------------------- |
| `PI7823Y`                          |                 1 | auto-criado por e-mail | **codigo de item virou processo** — mesma familia do SKU `PI7223Y` citado pela Leticia |
| `IM074`, `IM235`, `IM237`, `IM239` |        2, 6, 4, 2 | auto-criado por e-mail | referencia truncada (falta o bloco de 7 digitos)                                       |
| `PK208`, `PK210`                   |              4, 6 | auto-criado por e-mail | referencia truncada                                                                    |
| `PK2082605SZ LCL`                  |                10 | auto-criado por e-mail | codigo com sufixo " LCL" colado                                                        |
| `PK189`, `PUK003/005/006/012/015`  | 8, 1, 2, 11, 4, 1 | outra origem           | referencias curtas antigas                                                             |
| `teste123`                         |                 0 | outra origem           | **dado de teste em producao**                                                          |

O agravante nao e o processo fantasma em si: e que eles **carregam documentos
reais**. `PK2082605SZ LCL` tem 10 documentos, `IM235` tem 6, `PK210` tem 6.
Cada documento pendurado num processo truncado e um documento que falta no
processo verdadeiro — que e por que a analista nao encontra o que procura.

Isto e a medida do problema que o allow-list resolve daqui para frente. A
limpeza do que ja esta na base e um trabalho separado, de dado, listado em
"Pendente".

## Ponto 1 — Campos vindo "-"

### Diagnostico

Confirmado um bug real de codigo, com uma causa provavel adicional que **nao**
foi possivel confirmar sem acesso a producao.

**Confirmado — PDF escaneado enviado como PDF para provider que so le imagem.**
Em `documents/service.ts:extractText`, um PDF sem camada de texto util
(`charsPerPage < 150`) e mandado ao modelo como parte multimodal
`data:application/pdf;base64,...` dentro de um `image_url` no estilo OpenAI
(`ai/service.ts:buildUserMessage`). Isso funciona **apenas no Vertex**, que
converte a data-URL em `inline_data` do Gemini (`providers/vertex.ts`). O
provider **default e `ialocal`** (`AI_PROVIDER` default `'ialocal'` em
`shared/config/env.ts`), que fala com Ollama: a camada `/v1` dele decodifica a
data-URL como imagem, e um PDF nao e uma imagem. O mesmo vale para os modelos de
visao do OpenRouter. Resultado: a extracao "concluia" com quase nada preenchido.

Isso casa exatamente com o sintoma. `hasMeaningfulAiData` considera o documento
bom se **qualquer** campo aninhado tiver valor, e `documentAiProcessingStatus`
so marca `failed` quando nada veio. Dois campos preenchidos em vinte e cinco
passam como `completed`, e a tela desenha `-` nos outros vinte e tres
(`apps/web/src/features/documents/DocumentComparison.tsx:428`, `value || '-'`).

**REFUTADO — "o modelo preenche poucos campos".** Essa era a hipotese inicial e
os dados de producao a derrubam. Medicao read-only em 17/08, ~17:30 BRT:

| Config real em producao | Valor                                 |
| ----------------------- | ------------------------------------- |
| `AI_PROVIDER`           | **`vertex`** (nao `ialocal`)          |
| `AI_ALLOW_EXTERNAL`     | `true`                                |
| `AI_MONTHLY_BUDGET_USD` | `200` (nao 26, como dizia doc antiga) |
| `DOCUMENT_OCR_ENABLED`  | `1` — OCR **ligado**                  |
| `NODE_ENV`              | `production`                          |

Consequencia direta: **a correcao de rasterizacao nao muda nada em producao
hoje.** O Vertex le PDF nativamente (`acceptsPdfInput = true`) e o OCR esta
ligado, entao o caminho corrigido nem e alcancado. O bug e real e continua
valendo a pena — `ialocal` e o **default** do `AI_PROVIDER`, logo qualquer
ambiente sem configuracao explicita cai nele — mas ele **nao** e a causa do
relato da Eduarda.

Cobertura de campos nas invoices que extraem com sucesso (46 documentos):

| Metrica                      |     Valor |
| ---------------------------- | --------: |
| Campos por documento (media) |      20,3 |
| Campos preenchidos (media)   |      20,3 |
| Cobertura media              | **99,7%** |
| Pior caso                    |       95% |

Ou seja: quando a extracao conclui, ela vem praticamente completa. Nao existe o
cenario "dois campos de vinte e cinco".

**CONFIRMADO — o "-" vem de documento em falha terminal, nao de extracao
parcial.** Sao 17 documentos com `extractionFailed`, e nesses **todo** campo
fica vazio, o que desenha a tela inteira com "-":

| Causa                               | Qtd | Documentos / processos                                                     |
| ----------------------------------- | --: | -------------------------------------------------------------------------- |
| JSON invalido devolvido pelo modelo |   6 | 76 PK189, 88 PK2062602NB, 92 IM237, 146 e 151 PK2052602TJ, 154 PK2112606NB |
| `fetch failed`                      |   5 | 124, 125, 126, 128, 129 — todos de PK2082605SZ LCL, de **22/06**           |
| Timeout operacional de 180s         |   4 | 75 PK189, 85/86/87 PK2062602NB, de **22/06**                               |
| Sem dados uteis no documento        |   2 | 28 PK2072602NB, 44 PK2052602TJ                                             |

Por tipo: invoice tem 15 de 65 em falha (**23%**); packing_list 1 de 18; ohbl 1
de 10. Os 6 de "JSON invalido" com `updated_at` de 17/08 sao exatamente a
quarentena registrada em
`docs/STATUS-2026-08-17-LIMPEZA-REPROCESSAMENTO.md`.

Existe ainda um **passivo separado**: 19 documentos de tipo `other`, todos
criados em **11/03/2026**, nunca processados. Tipo `other` nao tem extractor
dedicado, entao eles nunca produziram campo algum. Nao sao regressao recente,
mas aparecem como "-" para quem abrir.

Nota sobre atribuicao: os 5 `fetch failed` sao de **22/06**, portanto **nao**
sao do incidente de egress de 01-14/08 — e outro evento de rede, anterior.

### O que mudou

- `AIProvider` ganhou a capability `acceptsPdfInput`: `true` no Vertex, `false`
  em `ialocal` e `openrouter`.
- Novo `rasterizePdfPages()` em `documents/ocr.ts`: renderiza as primeiras
  paginas do PDF para PNG usando **so o Poppler** (`pdftoppm`), sem depender do
  tesseract nem do opt-in de OCR. O binario ja esta na imagem da API
  (`apps/api/Dockerfile`, `poppler-utils`), entao a correcao funciona no
  ambiente atual.
- Quando o provider nao le PDF, o escaneado e rasterizado e enviado como
  imagens. `ImageExtractionOpts.additionalImagesBase64` foi acrescentado porque
  antes so cabia UMA imagem — uma invoice de duas paginas perdia a tabela de
  itens.
- Quando nao ha OCR nem rasterizacao possivel, a extracao **falha com motivo
  explicito** em vez de gravar um documento de campos vazios. Documento vazio
  que se apresenta como lido e pior que documento marcado como falho.
- A ordem de preferencia continua: texto nativo -> OCR local (se ligado) ->
  rasterizacao -> falha explicita.

### Testes

Quatro casos novos em `documents/__tests__/service.test.ts`, cobrindo: envia PNG
rasterizado em vez do PDF; falha alto quando nao consegue rasterizar; mantem o
PDF cru quando o provider aceita; e prefere OCR quando disponivel.

## Ponto 3 — Anexos so da pasta do processo no Drive

### Diagnostico

Nao existia ingestao Drive -> documentos. O fluxo era o inverso: o anexo chegava
por e-mail, era gravado em disco e **subido** para o Drive como backup
(`processor.ts` -> `uploadToSistemaInbox` / `uploadToProcessFolder`). O
`getSource()` de um documento deriva de linhagem relacional com
`emailAttachmentDocuments` e por isso so sabe dizer `email`.

A infraestrutura de leitura, porem, ja existia e nao estava sendo usada para
isso: `googleDriveService.listProcessFiles()` (recursivo, com paginacao) e
`downloadFileBuffer()`. A tabela `documents` ja tem `driveFileId`.

### O que mudou

Novo `apps/api/src/modules/documents/drive-ingestion.service.ts`, com a chave
`DOCUMENT_SOURCE`:

| Valor            | Efeito                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `email`          | Comportamento histórico, disponível apenas por configuração explícita.                                                                                       |
| `drive` (padrao) | So a pasta do processo no Drive alimenta o processo. A ingestao por e-mail para sozinha, sem precisar mexer em `EMAIL_INGESTION_ENABLED` e depois restaurar. |
| `both`           | As duas fontes.                                                                                                                                              |

Detalhes que importam na operacao:

- Dedupe por `driveFileId`, entao a varredura (cron `*/10`) e idempotente. Sem
  isso cada passada reimportaria a pasta inteira. `documentService.upload()`
  ganhou um parametro opcional para gravar esse id.
- A pasta e resolvida por `importProcesses.driveFolderId` e, quando ausente, por
  `findProcessFolder(codigo, marca)` — uma funcao **nova que nao cria nada**. A
  `ensureProcessFolder` existente e caminho de escrita e criaria a arvore de
  pastas como efeito colateral; ingestao nao pode poluir o Drive do time.
- Pasta, arquivo nativo do Google (Docs/Sheets) e extensao nao suportada sao
  pulados em vez de baixados. Teto de tamanho por arquivo
  (`DRIVE_INGESTION_MAX_FILE_BYTES`, padrao 25 MB).
- Um arquivo ilegivel nao aborta o resto da pasta, e um processo com erro nao
  aborta a varredura.
- O source ativo e logado no boot do scheduler: trocar isso muda de onde vem
  TODO documento, e nao pode ser descoberto pelo silencio.
- Trava de reentrancia na varredura. Ela e sequencial sobre todos os processos
  e pode passar dos 10 minutos do cron; duas passadas concorrentes correriam
  entre o SELECT de dedupe e o INSERT, e o `driveFileId` so protege depois de
  gravado.
- O dedupe confere `documents` **e** `espelhos`. O espelho gerado pelo sistema
  e publicado na subpasta "Espelho" da mesma pasta do processo, mas o
  `driveFileId` dele mora em `espelhos` — conferindo so `documents`, cada
  espelho publicado voltaria como documento novo.
- Arquivo cujo nome nao casa nenhuma regra de classificacao entra como `other`,
  que nao tem extractor: ele aparece, e marcado como processado com motivo e
  gera alerta. Efeito conhecido: a primeira varredura de uma pasta antiga pode
  abrir varios desses alertas de uma vez.

### Testes

`documents/__tests__/drive-ingestion.service.test.ts` — 11 casos, cobrindo os
tres valores de `DOCUMENT_SOURCE`, idempotencia, os pulos, o teto de tamanho, e
a resolucao de pasta sem criar nada.

## Acesso Da Odett — Verificado Em Producao, Nao Reproduz

A Odett relatou em 17/08 as 12:09 BRT "a gente nao ta conseguindo entrar aqui".
Consulta read-only a producao no mesmo dia, por volta de 17:30 BRT:

| Verificacao                                                       | Resultado                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| Conta `odett.hammes@grupounico.com`                               | `users.id=4`, `analyst`, `is_active=true`            |
| Login dela em 17/08                                               | **sucesso as 12:09:56 e as 16:05:45 BRT**            |
| Rota default do `importacao-api`                                  | `172.20.0.1` (rede do stack), **nao** `ia-local-net` |
| API alcanca `oauth2.googleapis.com`                               | sim, HTTP 400 (conexao OK, POST sem corpo)           |
| Alertas de login/grupo nas ultimas 10h                            | nenhum                                               |
| `not_in_group` / `error checking membership` / `ETIMEDOUT` no log | zero ocorrencias                                     |
| `sydle_sync_runs` nas ultimas 24h                                 | 144 execucoes, **todas** com sucesso                 |
| `importacao-api`                                                  | `RestartCount=0`, `ExitCode=0`, sem OOM              |

Conclusao: o problema foi transiente e se resolveu sozinho em cerca de um
minuto — o login bem-sucedido dela e do **mesmo minuto** da mensagem de queixa,
e ela entrou de novo quatro horas depois. A armadilha de rede de 01-14/08 nao
reincidiu: o `gw_priority` do `docker-compose.prod.yml` esta valendo e o egress
esta sadio. Nao ha evidencia de falha de checagem de grupo.

O que **nao** foi possivel apurar: a causa exata daquele minuto. O container da
API foi recriado as 19:21 UTC (de forma deliberada — sem crash, sem OOM), e com
isso o `docker logs` da janela das 15:09 UTC se perdeu. E exatamente a
armadilha ja registrada em memoria: recriar container descarta a unica trilha
fina que existe, porque `audit_logs` so grava login que deu certo.

Encaminhamento sugerido: nao ha correcao a aplicar. Se reincidir, baixar o log
do container **antes** de qualquer restart/deploy, e considerar gravar tambem a
tentativa de login que falha — hoje o unico detector de falha de acesso e a
propria usuaria no WhatsApp, o que ja esta em `docs/KNOWN_ISSUES.md`.

## Pendente — Depende De Configuracao Ou De Acesso A Producao

Nada abaixo e codigo. Sao as acoes de dado e de configuracao que faltam. Todas
exigem escrita em producao ou decisao de negocio, por isso nenhuma foi
executada.

1. **Reprocessar os 9 documentos cuja falha foi transporte, nao legibilidade.**
   Os 5 `fetch failed` e os 4 timeouts estao parados desde **22/06** — quase
   dois meses — e nunca foram retentados. A causa deles nao e documento
   ilegivel, e sim rede e teto de tempo, entao sao os candidatos mais fortes a
   recuperar sozinhos. Sao os processos `PK2082605SZ LCL`, `PK189` e
   `PK2062602NB`. **Nao executei**: reprocessar e escrita em producao e consome
   orcamento de IA, o que exige sua autorizacao explicita.
   Para os 4 timeouts, avaliar antes subir o teto de 180s — se o documento e
   legitimamente grande, retentar no mesmo teto so repete a falha.
   Os 6 de "JSON invalido" ja tinham recomendacao propria de **nao** fazer
   retentativa em massa (`STATUS-2026-08-17-LIMPEZA-REPROCESSAMENTO.md`):
   revisar classificacao e legibilidade e reprocessar individualmente.
2. **Decidir o que fazer com os 19 documentos `other` de 11/03.** Ou
   reclassificar para um tipo com extractor, ou aceitar que ficam sem extracao.
   Hoje eles so ocupam a tela com "-".
3. **Sanear os processos de codigo truncado que carregam documento real.**
   `PK2082605SZ LCL` (10 docs), `PK189` (8), `PUK006` (11), `IM235` (6),
   `PK210` (6), `IM237` (4), `PK208` (4), `PUK012` (4). Cada um precisa ser
   confrontado com a planilha Follow Up para descobrir o codigo verdadeiro e
   ter os documentos remanejados. **Nao ha automacao segura para isso**: exige
   decisao humana caso a caso, porque so o time sabe qual processo real cada
   documento pertence. `PI7823Y` e codigo de item e `teste123` e dado de teste
   — esses dois provavelmente saem por exclusao, nao por remanejo.
4. **Resolver as 14 duplicatas de documento** (mesmo processo, mesmo nome,
   mesmo tamanho) antes de qualquer reprocessamento, senao o lote gasta o dobro
   no mesmo arquivo.
5. **Ligar o ponto 2**: `GOOGLE_SHEETS_FOLLOW_UP_ID` preenchido (hoje esta
   **vazio** em producao, confirmado) e a planilha
   Follow Up compartilhada (leitor) com a SA em `GOOGLE_DRIVE_CLIENT_EMAIL`.
   Enquanto isso não existir, o contrato atualizado falha fechado e não
   vincula, cria ou ingere. Confirmar também que a coluna A continua sendo a
   coluna de referência usada pela operação.
6. **Ligar o ponto 3**: `GOOGLE_DRIVE_ROOT_FOLDER_ID` com valor real. Hoje esta
   com o placeholder `your-root-folder-id`, ou seja a integracao Drive esta
   inativa (ja registrado em
   `docs/STATUS-2026-08-17-LIMPEZA-REPROCESSAMENTO.md`). A pasta raiz precisa
   estar compartilhada com a SA. `DOCUMENT_SOURCE=drive` já é o padrão; sem
   raiz real a varredura permanece bloqueada. O modo `both` só deve ser
   reativado por decisão explícita da operação.
7. **A convencao de pasta precisa ser confirmada com o time.** A ingestao
   procura `raiz/Marca/CODIGO`. Se o time organiza a pasta do processo de outra
   forma, o mapeamento muda — vale confirmar com a Eduarda antes de ligar.

## Revisao Adversarial Do Proprio Trabalho

Revisao feita depois de a entrega estar "verde". Ela achou cinco defeitos reais
no que tinha acabado de ser escrito; todos corrigidos com teste antes de fechar.

1. **`ALTO` — recusa silenciosa.** Quando o allow-list rejeitava TODOS os
   candidatos, `processCode` virava nulo e o fluxo pulava o ramo que abre o
   alerta de operador. O e-mail caia sem processo e sem aviso. Rejeitar lixo era
   o objetivo; rejeitar em silencio teria repetido o padrao de falha silenciosa
   que ja custou 12 dias de incidente nao detectado nesta casa. Agora abre
   alerta nomeando os codigos recusados.
2. **`ALTO` — substring sobrevivia na indisponibilidade.** `exactOnly` estava
   condicionado a o allow-list estar legivel. Com a planilha fora do ar, o
   sistema voltava a casar referencia por substring — exatamente o defeito
   relatado pela Eduarda, so que sem ninguem saber. Agora o match exato vale
   sempre que a fonte for a planilha.
3. **`MEDIO` — espelho reimportado.** O dedupe da ingestao do Drive conferia so
   `documents`. O espelho gerado pelo sistema e publicado na subpasta "Espelho"
   da mesma pasta do processo, mas o `driveFileId` dele mora em `espelhos`:
   cada espelho publicado voltaria como documento novo na varredura seguinte.
   O dedupe passou a conferir as duas tabelas.
4. **`MEDIO` — varredura sem trava de reentrancia.** A varredura e sequencial
   sobre todos os processos e pode passar dos 10 minutos do cron. Duas passadas
   concorrentes correriam entre o SELECT de dedupe e o INSERT, e o mesmo
   arquivo entraria duas vezes — o `driveFileId` so protege depois de gravado.
5. **`BAIXO` — typecheck quebrado por teste.** Um `afterEach` sem import passou
   despercebido porque o `tsc` tinha rodado ANTES do bloco de testes ser
   acrescentado. A suite ficava verde e o typecheck vermelho. Corrigido, e vale
   como lembrete de rodar typecheck DEPOIS do ultimo arquivo tocado.

Um sexto ponto virou melhoria de projeto: a regra do allow-list foi extraida
para `filterCandidatesByFollowUp`, funcao pura, porque dentro do laco de e-mail
ela so seria testavel com Gmail, IMAP e banco de pe. Ela tambem expos um
vazamento de estado entre testes (a trava de modulo da varredura), resolvido com
um seam de reset explicito em vez de ordem de teste sortuda.

Verificacoes que passaram sem achado: o gate de volume do estoque
(`cert-api`), a ordenacao numerica das paginas rasterizadas, a persistencia do
`driveFileId` nos tres call sites que publicam na pasta da marca, a ausencia de
chave duplicada no `.env.example`, e o fato de nenhuma das variaveis novas com
validacao estrita estar definida em producao — portanto sem risco de quebrar o
boot no deploy.

## Riscos Residuais

- A rasterizacao **nao muda producao hoje** (Vertex le PDF e o OCR esta ligado).
  Ela protege quem rodar com `ialocal`/`openrouter` — e `ialocal` e o default do
  `AI_PROVIDER`, entao qualquer ambiente novo sem configuracao explicita cai
  nesse caminho. Vale como correcao latente, nao como resposta ao relato.
- A taxa de falha terminal em invoice e de **23%** (15 de 65). Enquanto ela
  estiver nesse patamar, sempre havera documento desenhando a tela com "-",
  independente de qualquer melhoria de cobertura de campo. A metrica a seguir e
  essa taxa, nao a cobertura — que ja esta em 99,7%.
- "JSON invalido devolvido pelo modelo" e a maior causa isolada (6 de 17). Vale
  investigar se o `responseSchema`/structured output esta sendo aplicado nessas
  chamadas ou se o documento estoura o teto de tokens de saida e a resposta
  chega truncada — resposta truncada e JSON invalido pela definicao.
- `extractionCoverage` (em `documents/service.ts`) ja mede quantos campos foram
  lidos por documento e existe desde uma queixa anterior da mesma usuaria
  ("leu so 78%"). A metrica foi construida e o problema nao foi fechado na
  epoca. Vale usar a metrica como criterio de aceite desta rodada, e nao repetir
  o padrao de medir sem corrigir.
- `DOCUMENT_SOURCE=drive` desliga a ingestao por e-mail. Se o time ainda receber
  documento que so chega por e-mail, ele deixa de entrar. `both` evita esse
  buraco durante a transicao.

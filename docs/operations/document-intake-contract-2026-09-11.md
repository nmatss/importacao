# Contrato de entrada de documentos pelo Drive — pasta PROCESSOS

Data: 2026-09-11
Origem do requisito: reunião de 11/09/2026 (Eduarda e Odett), decisão D1
Substitui parcialmente: `document-intake-contract-2026-08-28.md` (cláusulas 7, 8,
o parágrafo "a pasta deve seguir a convenção `raiz/Marca/CODIGO`" e a regra de
`other`)

## O que mudou e por quê

O contrato de 28/08 foi escrito para o layout observado naquele momento
(`<raiz>/<Marca>/Importado/Processo Nº <código>`, em Shared Drive). A pasta real
que a operação usa é outra, e o acesso da conta de serviço só foi liberado em
11/09. Com a árvore real em mãos:

- as marcas têm prefixo numérico e nível de ano (e, às vezes, de coleção ou de
  faturamento), então o localizador antigo nunca casava;
- existe uma pasta de ENTRADA na raiz, `04. PENDENTES DE CORREÇÃO`, que nenhum
  caminho de leitura consultava;
- os espelhos vivem numa pasta plana, `01. ESPELHOS`, e 316 dos 376 são Google
  Sheets NATIVOS — a ingestão os pulava sempre, porque `alt=media` não serve
  para arquivo nativo.

## Estrutura reconhecida

```
PROCESSOS/
  01. ESPELHOS/                      <arquivos planos: Sheets nativos e .xlsx>
  02. IMAGINARIUM/<ano>/[FAT <mês>/]<processo>/
  03. PUKET/<ano>/[<coleção>/]<processo>/
  04. PENDENTES DE CORREÇÃO/<processo>/
```

Regras de nome, todas com teste tabelado em
`apps/api/src/modules/documents/__tests__/drive-layout.test.ts`:

1. Área é reconhecida pelo nome normalizado (sem acento, sem caixa, prefixo
   numérico opcional). `GOOGLE_DRIVE_PENDENTES_FOLDER_ID` e
   `GOOGLE_DRIVE_ESPELHOS_FOLDER_ID` sobrepõem o nome quando definidos.
2. Em cada ano, pasta cujo nome COMEÇA com um código de processo conhecido
   (após `trim`, terminando no fim do nome ou num separador não alfanumérico) é
   pasta de processo. Qualquer outra é grupo: desce-se UM nível e a regra se
   repete. Não existe lista fixa de nomes de coleção ou de `FAT`.
3. O ano da pasta é o ano da COLEÇÃO, não o do código: `PK2192607SZ` e
   `PK2202608SZ` ficam em `03. PUKET/2027/HIGH SUMMER`. Nunca filtrar pelo ano
   derivado do código.
4. Nome legado curto (`2080_SZ`, `2066_SZB`, `2070_SZ_AIR`) não corresponde a
   nenhum processo do sistema e é ignorado, aparecendo no status como pasta sem
   código conhecido.
5. Duas pastas com o mesmo código são lidas (o localizador anterior usava
   `pageSize: 1` e via só uma, sem critério), com deduplicação por conteúdo e
   aviso de pasta duplicada.

## Prioridade e escopo da leitura

- Prioridade POR TIPO de documento: para cada tipo, o arquivo em
  `04. PENDENTES DE CORREÇÃO` vence; os tipos que PENDENTES não tem vêm da pasta
  da marca. A regra literal ("se PENDENTES tem algo, ignore a marca") perderia o
  BL que só existe na pasta da marca.
- Espelho vem SOMENTE de `01. ESPELHOS`, casando `<código> - Espelho` e
  variações, excluindo `CONSOLIDADO` e `(antigo com erro)`. Sheets nativo é lido
  por `files.export` em xlsx; `.xlsx` binário continua por download direto.
  Mais de um espelho válido para o mesmo código: usa o mais recente e marca
  ambiguidade no status.
- Dentro da pasta do processo, a varredura lê os arquivos diretos e desce apenas
  nas subpastas por tipo do layout antigo do próprio sistema (Invoice, Packing
  List, BL, Espelho, Outros). Subpasta de versão anterior (`Backup`, `Antigo`,
  `Old`...) NÃO é lida: a pasta real do `PK2202608SZ` tem um `Backup/` com a
  invoice antiga.
- Arquivo que o classificador não reconhece NÃO vira documento `other` pela
  varredura (muda a cláusula equivalente de 28/08): ele é listado no status como
  "tipo de documento não reconhecido pelo nome". O upload manual continua podendo
  criar `other`.
- Arquivo que não é do fluxo (CT-e, manifesto, `fat_*.pdf`, `FATURA<número>` do
  transportador) é ignorado explicitamente. Sem isso, a fatura de frete entraria
  como `invoice` — o classificador casa "fatura" — e contaminaria o comparativo.
- A allow-list do Follow Up continua valendo: processo fora do snapshot não é
  lido, e a indisponibilidade da planilha bloqueia a varredura (falha fechada).

## Identidade do documento: conteúdo, não id do Drive

- Todo upload (manual, e-mail ou Drive) grava `documents.content_sha256`.
  Arquivos vindos do Drive gravam também `drive_md5`, `drive_version`,
  `drive_modified_time` e `drive_area`.
- A varredura pula antes de baixar quando o `md5Checksum` já existe no processo,
  e depois de baixar quando o `sha256` já existe. Isso cobre arquivo copiado (id
  novo, mesmo conteúdo), pasta duplicada e o arquivo que a analista subiu a mão
  antes de ele aparecer no Drive.
- Documento excluído por um analista NÃO volta: a varredura consulta
  `document_ingestion_tombstones` por `drive_file_id` e por
  (`process_id`, `content_sha256`) antes de importar.
- Conteúdo alterado no mesmo arquivo (por exemplo, espelho editado no Sheets)
  entra como documento novo; o seletor "mais recente" do comparativo já usa o
  último.
- Documento já importado nunca é apagado porque o arquivo saiu da pasta.

## Escrita: PROCESSOS é somente leitura

`DRIVE_WRITE_MODE` (`off` | `sistema`) é a chave única. Sem valor explícito, o
padrão é `off` quando `DOCUMENT_SOURCE` inclui `drive` e `sistema` quando a
fonte é `email` (comportamento histórico preservado).

Com `off`:

- `moveToCorrection` / `moveFromCorrection` (a validação reprovada MOVIA a pasta
  do processo), `uploadToProcessFolder`, INBOX/PROCESSADOS do e-mail, relatório
  de validação e ALERTAS viram no-op com log `info`;
- `createFolder` e `uploadFile` lançam — são o ponto mais baixo e só chegam ali
  por furo de guarda;
- o token pede escopo `drive.readonly`.

Há guarda estática: todo `files.create`/`files.update` do serviço precisa passar
pela verificação de modo. O estado de correção continua no banco
(`correction_status`); o sistema não move pasta de ninguém.

## Upload manual

`MANUAL_UPLOAD_ENABLED` (padrão `true`) passa a ser a única chave do upload pela
tela — antes ele era desligado por `DOCUMENT_SOURCE=drive`, e em 11/09 a operação
dependeu justamente dele para os três processos-piloto e para trocar o tipo e
reprocessar. A decisão da reunião foi sobre e-mail x Drive, não sobre tirar a mão
da analista do processo. O dedupe por conteúdo evita a duplicata quando o mesmo
arquivo aparecer depois na pasta.

## Observabilidade

- `GET /api/documents/process/:processId/drive-status`: política de fonte,
  resumo da última varredura e o resultado DESTE processo (pastas encontradas por
  área, importados/ignorados/falhas e o motivo de cada arquivo ignorado). É a
  resposta para "tinha tudo no Drive e o sistema não tinha nada".
- `GET /health/integrations` passa a informar as 4 áreas resolvidas, o modo de
  escrita, o upload manual e a última varredura (totais, pastas duplicadas,
  pastas sem processo). Avisa quando uma área não resolve, quando a varredura
  não rodou e quando a última terminou há mais de 30 minutos.
- Pasta de um código que está no Follow Up e ainda não existe como processo: só
  alerta (`orphanFolders`). A varredura nunca cria processo a partir do nome de
  pasta.

## O que falta FORA do código (DRV-09) — nada executado aqui

Ordem obrigatória; inverter deixa o sistema sem nenhuma via de entrada:

1. A dona de PROCESSOS compartilha a pasta inteira com o e-mail da conta de
   serviço (`GOOGLE_DRIVE_CLIENT_EMAIL`), papel **Leitor**. Feito em 11/09 para
   leitura; confirmar que permanece.
2. Deploy deste código com `DOCUMENT_SOURCE` ainda `email`.
3. Backfill de `content_sha256` dos documentos já existentes (16 uploads manuais
   de 11/09 nos processos 287/288/297) — leitura do volume local + UPDATE em
   coluna nova. **Exige autorização**; sem ele, esses arquivos entram de novo
   como documentos do Drive na virada.
4. Via SOPS: `GOOGLE_DRIVE_ROOT_FOLDER_ID` = id de PROCESSOS; opcionalmente
   `GOOGLE_DRIVE_PENDENTES_FOLDER_ID` e `GOOGLE_DRIVE_ESPELHOS_FOLDER_ID`;
   `DRIVE_WRITE_MODE=off`. As variáveis já constam da lista explícita dos
   compose e do `.env.sops.yaml.example`. Lembrar que `${VAR:-}` passa string
   vazia, e vazio = ausente.
5. Smoke somente leitura: `/health/integrations` sem aviso de Drive, com as 4
   áreas resolvidas; conferir `drive-status` de `PK2202608SZ`, `PK2192607SZ` e
   `IM0762607NB`.
6. Trocar `DOCUMENT_SOURCE` para `drive` e redeploy.
7. Conferir em produção `documents.ingestion_source='drive'` com `drive_file_id`
   preenchido e ausência de duplicata por `content_sha256`.

## Por que o PK220 chegou vazio à reunião (DRV-04)

Cadeia completa, medida em produção (somente SELECT):

1. `DOCUMENT_SOURCE=email` — a varredura do Drive retornava no início.
2. `GOOGLE_DRIVE_ROOT_FOLDER_ID` era o placeholder `your-root-folder-id`.
3. A conta de serviço recebia 404 na pasta (acesso só liberado em 11/09).
4. Mesmo sem (1)-(3), o localizador não acharia a pasta e o espelho nativo seria
   pulado.
5. A via de e-mail, que era a fonte ativa, descartou as 7 mensagens de
   `kiomglobal.com` citando PK220/PK219/IM076 como "Remetente não autorizado"
   (`EMAIL_ALLOWED_SENDERS`). Nos últimos 15 dias: 50 descartadas, 0 concluídas
   em 60 dias.
6. Nada disso aparecia na tela: o processo só ficava vazio.

O item (6) é o que este contrato corrige no código. O (5) é decisão do fluxo de
e-mail: com "somente Drive", o e-mail fica desligado e a allow-list de remetentes
deixa de ter efeito prático.

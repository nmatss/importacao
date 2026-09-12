# Sincronizacao Follow Up -> banco (`FOLLOW_UP_SYNC_MODE`)

Decisao D4 da reuniao de 11/09/2026. Escrito para a primeira execucao em
producao ser conferida antes de gravar qualquer coisa.

## O problema que ela resolve

A referencia do sistema (FOB, ETA, chegada no CD, registro da DUIMP) era um
**snapshot de 25/08/2026**, feito a mao com `scripts/import-follow-up.js` a
partir de um xlsx baixado. Nao havia nenhum job lendo a planilha. Efeitos
medidos em 11/09:

| Processo    | Campo      | Planilha                  | Banco      | Tela                 |
| ----------- | ---------- | ------------------------- | ---------- | -------------------- |
| PK2202608SZ | FOB        | 101.346,01                | 101.265,19 | 101.246,01 (invoice) |
| PK2192607SZ | Atracacao  | 08/09 (ETA Realizado)     | eta 17/09  | "ETA: 16/09"         |
| PK2192607SZ | Registro   | 26BR0001660880-2 em 04/09 | `NULL`     | passo sem data       |
| PK2192607SZ | Chegada CD | 11/09                     | 22/09      | "21/09"              |

## Como funciona

- Le a aba `Processos` (`GOOGLE_SHEETS_FOLLOW_UP_TAB`, padrao `Processos`) de
  `A` ate `DZ` — a leitura antiga parava no `Z`, e ETA, registro e Chegada CD
  ficam depois disso.
- Mapeia por **cabecalho normalizado** (sem acento, sem caixa, sem o `*`), nunca
  por indice de coluna: `apps/api/src/modules/follow-up/sheet-columns.ts`.
- Escreve **somente** em `import_processes`, e so em processo ativo e
  destravado. Nenhuma celula da planilha e alterada.
- Celula vazia, `#ERROR!`, `-` ou texto livre ("EM TEMPO") = **indisponivel**:
  mantem o valor anterior e entra no relatorio com o motivo. Nunca vira `0`
  nem `NULL`.
- Datas de calendario gravadas em coluna `timestamp` usam `localDayStartUtc`
  (meia-noite em Sao Paulo), para a tela mostrar o dia escrito na planilha.
- Atracacao: `ETA Realizado` -> `eta_actual`, `ETA Final*` -> `eta`,
  `ETA Armador*` -> `eta_carrier`. **`ETA Previsto Medio` nao alimenta nada.**
- Numero de registro no padrao `26BR0000000000-0` vai para `duimp_number`;
  qualquer outro formato vai para `di_number`.
- O `Status` da coluna B e guardado em `ai_extracted_data.sheetStatus` (com
  `sheetStatusSyncedAt`) e passa a mandar na derivacao do estagio logistico.

## Modos

| `FOLLOW_UP_SYNC_MODE` | Efeito                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| `off`                 | Nao le a planilha.                                                                    |
| `dry_run` (padrao)    | Calcula o diff e registra no log. **Nao grava.**                                      |
| `apply`               | Grava os campos divergentes, com audit (`follow_up_sheet_sync`) e evento de processo. |

Agendamento: a cada 30 minutos, junto do `logistic-sync`
(`apps/api/src/jobs/scheduler.ts`). No log, procure
`follow-up sheet sync (dry-run)` e a chave `diff`.

Endpoint manual (admin): `POST /api/follow-up/sync-from-sheet/:processCode`
com `{"mode":"dry_run"}` ou `{"mode":"apply"}`. `apply` so grava se
`FOLLOW_UP_SYNC_MODE=apply` tambem estiver configurado — duas chaves, nao uma.
O modo `industrial` foi removido: ele gravava a string `07/08/2026` numa coluna
`date` e o FOB dividido por mil.

## Antes de ligar o `apply` em producao

1. Subir com `dry_run` e ler o diff de pelo menos um ciclo.
2. Conferir o relatorio: `missingColumns` vazio (nenhuma coluna renomeada),
   `duplicatedCodes` conhecido, `unknownCodes` sao mesmo processos que nao
   existem aqui.
3. Conferir a lista de `unavailable`: `#ERROR!` na planilha e problema da
   FONTE, e a equipe precisa saber (ex.: `Valor Invoice (USD)` do IM0762607NB).
4. So entao trocar a variavel e reiniciar. A primeira execucao com `apply`
   altera dados de producao e exige autorizacao explicita.

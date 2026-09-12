# Gabarito do Drive real (lido pela conta de servico, somente leitura, 11/09/2026 ~21:25 BRT)

Arquivos brutos: `drive-arvore-real.json` (raiz, areas, anos, grupos) e `drive-arvore-extra.json` (grupos FAT da Imaginarium e arquivos de PK2192607SZ/PK2202608SZ). Acesso Leitor aprovado em 11/09.

## Estrutura

- `04. PENDENTES DE CORREÇÃO` (acentuado de verdade: "CORREÇÃO"): 13 pastas, `PK2122607NB` duplicada, 65 arquivos. Codigos: PK2122607NB x2, PK3022609SZ, PK2292608SZ, PK2282608SZ, PK3032609SZ, PK2242608SZ, PK2162608NB, IM0762607NB, IM0772608NB, IM0782608SZ, PK2262608SZ, PK2172607XI.
- `01. ESPELHOS`: 376 itens — 316 Google Sheets nativos e 59 .xlsx (tambem existem espelhos xlsx binarios!).
- `03. PUKET/<ano>/`: 2024 e 2025 so tem grupos de colecao (`HIGH WINTER 2024`, `SUMMER 2025`...); 2026 mistura processos direto (`PK2072602NB`, `PKT-0032-BD-SEA`, `PKT-0033-IN`) com colecoes (`HIGH SUMMER - 26`, `SUMMER - 26 ` com espaco no fim); 2027 tem `HIGH SUMMER` e `SUMMER` (sem ano no nome).
- **PK2192607SZ e PK2202608SZ ficam em `03. PUKET/2027/HIGH SUMMER/`** — ano da pasta = ano da colecao, nao do processo.
- `02. IMAGINARIUM/<ano>/FAT <mes>/<processo>`: nivel intermediario de faturamento com grafias variadas (`FAT 11`, `FAT 09 E 10`, `FAT - 08`, `FAT-06`, `Fat - 03`). Ate 2023/inicio de 2024 as pastas de processo tinham nome curto legado (`2080_SZ`, `2066_SZB`, `2070_SZ_AIR`) — NAO casam com codigo e devem apenas ser ignoradas (nenhum processo do sistema usa esse padrao; os 29 codigos Imaginarium do sistema sao IM048..IM080). Desde `2024/FAT 07 e 08` o nome e o codigo completo, as vezes com sufixo (`IM0112407NB - Licença de importação`) ou espaco no fim (`IM0302409NB `), e existe `IMG-0001-BD`.
- Regra correta: em cada ano, pasta cujo nome COMECA com codigo de processo (apos trim, seguido de fim ou separador nao alfanumerico) = processo; qualquer outra = grupo (colecao OU FAT), descer UM nivel e aplicar a mesma regra. Nada de lista fixa de nomes de colecao.

## Conteudo das pastas de processo (PK2192607SZ / PK2202608SZ)

- Documentos alvo: `2026.08.07 KIOM INV - PK2192607SZ.pdf`, `KIOM CI - <cod>.xlsx`, `KIOM PL - <cod>.pdf/.xlsx`, `<cod> OHBL COPY.pdf`, `Puket - 439 - OHBL COLORIDO.pdf`, `Extrato-DUIMP-26BR00016608802-Versao-0001 - PUK032-26 - PK2192607SZ.pdf` (DUIMP registrada, nao rascunho).
- Nao-documentos do fluxo: `manistesto cte 5462.pdf`, `2026.09.10 - CTE - 4226...pdf`, `2026.09.10 - FATURA2103.pdf`, `fat_138902_73839.pdf`. Ingerir tudo como `other` geraria um alerta de operador por arquivo na primeira varredura.
- **Subpasta `Backup/` dentro do PK2202608SZ** com `2026.04.08 KIOM INV - PK2202608SZ.pdf` e `KIOM PL - PK2202608SZ.pdf` antigos — conteudo diferente do atual; a recursao importaria duas invoices.

## Implicacoes para o codigo (verificar apos o merge da onda B)

1. Indexador: regra "codigo no inicio do nome = processo, senao grupo" com trim e sufixos; ignorar legado curto; nao filtrar por ano do codigo.
2. Dentro da pasta do processo: NAO descer em subpastas de backup/antigo (`Backup`, `Antigo`, `Old`, `Versao anterior`, nomes com "backup"/"antig") — ideal: so arquivos diretos + subpastas de tipo conhecidas (Invoice/Packing List/BL/Espelho/Outros, layout antigo do proprio sistema).
3. Arquivos que o classificador nao reconhece: NAO criar documento `other` pela varredura do Drive (listar no status do sweep como "ignorado: tipo nao reconhecido"); upload manual continua podendo criar `other`.
4. `Extrato-DUIMP-...` deve classificar como DUIMP registrada (conferir classify-document); `RASCUNHO DUIMP` como draft_duimp.
5. Espelhos: aceitar Sheets nativo (export) E xlsx binario na pasta 01. ESPELHOS.
6. Teste de aceitacao com este gabarito: o indice deve encontrar PK2192607SZ e PK2202608SZ em PUKET/2027/HIGH SUMMER, IM0752606NB em IMAGINARIUM/2026/FAT - 08, as 13 pastas de PENDENTES (2 para PK2122607NB) e casar o espelho de PK2192607SZ em 01. ESPELHOS.

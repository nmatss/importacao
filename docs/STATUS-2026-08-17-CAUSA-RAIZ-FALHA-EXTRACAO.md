# Status — Causa-Raiz Das Falhas De Extracao — 2026-08-17

## Objetivo

Sair do "reprocessa e torce" e descobrir POR QUE 17 documentos estao em falha
terminal em producao — estado em que **todo** campo fica vazio e a tela mostra
"-" em tudo, que e o relato original da Eduarda.

Referencias: `docs/STATUS-2026-08-17-IMPORTACAO-PEDIDOS-EDUARDA.md` (onde a
falha terminal foi medida) e `docs/KNOWN_ISSUES.md`.

## Como Os 17 Se Distribuem

Consulta read-only a producao em 17/08. Os arquivos sao **pequenos** — de 11 KB
a 1,2 MB —, portanto nenhuma das falhas e por tamanho de arquivo.

| Causa gravada    | Qtd | O que os arquivos revelam                                                                               |
| ---------------- | --: | ------------------------------------------------------------------------------------------------------- |
| JSON invalido    |   6 | Todos PDF de 185 KB a 768 KB, nomes "KIOM PI/INV" — invoice e proforma reais e legiveis                 |
| `fetch failed`   |   5 | Todos do processo `PK2082605SZ LCL`, de **22/06**                                                       |
| Timeout de 180 s |   4 | **Tres sao XLSX de 25 a 36 KB** — tamanho que nao justifica 180 s                                       |
| Sem dados uteis  |   2 | Doc 44 e `PUKET - 424 - OHBL PB.PDF` classificado como **invoice**; doc 28 e `Captura de tela ... .png` |

Tres achados saltam so dessa tabela:

- **Classificacao errada** explica os 2 de "sem dados uteis". Um OHBL e uma
  captura de tela foram classificados como invoice; o extractor de invoice
  procurou dado de invoice e nao achou, corretamente. Reprocessar sem
  reclassificar repete a falha.
- **Duplicatas reais**: documentos 146 e 151 sao o mesmo arquivo (mesmo nome,
  223.881 bytes) no mesmo processo; 125 e 129 tambem (163.021 bytes).
- **Nome do arquivo x processo divergem** em pelo menos dois casos (doc 154 tem
  `PK2092606SZ1` no nome e esta em `PK2112606NB`; doc 92 tem `IM2382607ANB` e
  esta em `IM237`).

## A Hipotese De Truncamento Foi REFUTADA

A suspeita registrada antes era que a resposta batia no teto de tokens de saida
e chegava cortada. A telemetria de `ai_usage_log` derruba isso: o teto de
`invoice_extraction` e 16.384 tokens e a **maior saida ja registrada foi 8.993**.
Nenhuma chamada chegou perto do teto.

## A Assinatura Real: Prompt Grande Quebra O Contrato

Agrupando as 22 chamadas de `invoice_extraction` pelo tamanho do prompt:

| Faixa                   | Chamadas | Saida media (tokens) | Latencia media | Seguidas do passo de self-repair |
| ----------------------- | -------: | -------------------: | -------------: | -------------------------------: |
| Prompt **> 10k tokens** |       10 |                3.714 |     **68,9 s** |                            **0** |
| Prompt normal           |       12 |                1.605 |         19,3 s |                                8 |

O `invoice_self_repair` so acontece depois do parse bem-sucedido. **Nenhuma**
das 10 chamadas de prompt grande chegou la; 8 das 12 normais chegaram. A
correlacao e praticamente perfeita: acima de ~10k tokens de prompt, o modelo
primario (`gemini-2.5-flash`) para de honrar o contrato JSON, e a latencia
triplica.

Portanto a causa nao e o documento ser ilegivel, nem o teto de saida: e o
tamanho do prompt degradando a obediencia ao formato.

## O Que Foi Corrigido

### 1. O parse nao tolerava nada em volta do JSON

`safeJsonParse` era um `JSON.parse` cru sobre a resposta inteira. Cerca
markdown, uma frase de preambulo ou um rodape derrubavam a extracao inteira, e
um documento perfeitamente extraido virava falha terminal com todos os campos
vazios.

Novo `apps/api/src/modules/ai/utils/json-payload.ts`: recorta o primeiro
objeto/array **balanceado**, com a contagem de profundidade respeitando string
literal e escape — sem isso, uma chave dentro de `"caixa {grande}"` fecharia o
recorte no lugar errado e produziria um JSON valido porem truncado, que e pior
que falhar porque entraria como dado bom. Nao ha conserto criativo do conteudo:
so se descarta o que envolve o payload.

Quando ainda assim nao da, o erro passa a dizer a causa — `truncated` versus
`no_json` — porque a acao do operador e diferente em cada caso, e esse texto e o
que aparece na tela para o time.

### 2. O escalonamento de modelo ignorava violacao de contrato

`extractWithUpgrade` ja sabia reextrair com `gemini-2.5-pro`, mas **so por
confianca baixa**. Se o primario devolvia algo fora do contrato, a excecao subia
e o documento morria sem que o modelo melhor fosse sequer tentado — exatamente o
que aconteceu com as 10 chamadas de prompt grande.

Agora uma `AIResponseContractError` no primario escalona uma vez para o modelo
de upgrade. O escalonamento e **exclusivo** de violacao de contrato: orcamento
estourado e timeout nao melhoram num modelo mais lento e mais caro, e continuam
subindo direto. Desligavel por `AI_UPGRADE_ON_CONTRACT_ERROR=0`.

### 3. Planilha virava texto sem limite nenhum

O XLSX era convertido com `sheet_to_csv` sem nenhum corte. Quando alguem formata
uma coluna inteira, o range usado da planilha vai ate a ultima linha e o CSV
vira centenas de milhares de linhas de virgulas. Um XLSX de 27 KB gerava prompt
suficiente para estourar o teto de 180 s — e tres dos quatro timeouts de
producao sao exatamente XLSX de 25 a 36 KB.

Agora: `blankrows: false`, descarte de linhas que so tem separador, e teto de
caracteres (`DOCUMENT_SPREADSHEET_MAX_CHARS`, padrao 200.000) com marca explicita
de truncamento no texto.

Este item tambem ataca a causa da secao anterior pelo outro lado: menos ruido no
prompt significa menos chamadas caindo na faixa dos 10k tokens.

## Testes

- `apps/api/src/modules/ai/utils/__tests__/json-payload.test.ts` — 20 casos,
  incluindo chave dentro de string, aspas escapadas, resposta cortada no meio, e
  a distincao entre `truncated` e `no_json`.
- Tres casos novos em `documents/__tests__/service.test.ts` para o corte de
  ruido e o teto da planilha.
- Suite `apps/api`: 941 passando.

## O Que NAO Foi Feito, E Por Que

**Nenhum documento foi reprocessado.** Reprocessar agora rodaria o codigo que
esta em producao, que e o codigo **sem** estas tres correcoes — os 6 de JSON
invalido tornariam a falhar e o unico efeito seria consumir orcamento de IA. A
ordem correta e: publicar as correcoes, depois reprocessar, depois medir.

Alem disso:

- **Reclassificar antes de reprocessar** os documentos 44 (OHBL como invoice) e
  28 (captura de tela como invoice). Sem isso eles falham de novo, com razao.
  Existe `PATCH /api/documents/:id/classification`.
- **Decidir sobre as duplicatas** 146/151 e 125/129 antes do lote, senao o
  reprocessamento gasta o dobro no mesmo arquivo.
- O script de lote `scripts/reprocess-documents.mjs` ja existe, com dry-run
  padrao, ritmo proprio, log JSONL e retomada. Ele exige `API_TOKEN` de admin,
  que **nao** foi emitido nesta sessao — emitir credencial de administracao e
  decisao do Nicolas, nao minha.

## Riscos Residuais

- O escalonamento por violacao de contrato adiciona, no pior caso, uma chamada
  extra ao modelo `pro` por documento que falhar. So ocorre em falha, mas muda o
  custo por documento problematico — acompanhar em `/api/ai/usage`.
- O corte da planilha e por numero de caracteres, nao por relevancia. Uma
  planilha legitimamente gigante perde a cauda. O marcador de truncamento fica
  no texto para que isso seja visivel, mas o limite ideal por tipo de documento
  ainda nao foi calibrado com dado real.
- A correlacao "prompt > 10k quebra o contrato" vem de 22 chamadas. E forte
  (10 de 10 contra 8 de 12) mas a amostra e pequena; reavaliar depois do
  proximo lote.
- `ai_usage_log` tem 95 linhas, **todas** `status='success'`, embora o codigo
  afirme persistir erro sempre. Falha de parse realmente entra como sucesso
  (o erro acontece depois da chamada), mas timeout e erro de provider deveriam
  aparecer e nao aparecem. Vale conferir se o caminho de erro grava mesmo.

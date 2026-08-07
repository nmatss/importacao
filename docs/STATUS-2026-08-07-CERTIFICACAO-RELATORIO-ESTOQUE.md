# STATUS 2026-08-07 — Certificacao: relatorio, status e estoque

Origem: feedback da Eduarda sobre o relatorio de produtos, tres SKUs com status
errado (100400496, PI7560Y, PI7223Y) e divergencia de estoque no PI7223Y.

Todo numero abaixo foi medido contra a planilha real, o Linx, o WMS e o
PostgreSQL de producao em 2026-08-07. Nenhuma escrita foi feita em producao
durante o diagnostico.

## Sumario

| #   | Sintoma reportado                                   | Causa raiz                                                                             | Situacao              |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| 1   | Relatorio nao reflete os status do painel           | Excel mostrava `last_validation_status` (scraping VTEX) em vez das dimensoes derivadas | Corrigido             |
| 2   | "Tipo de certificacao" traz o prazo de encerramento | Sync gravava `"ENCERRAMENTO - Prazo: dd/mm/aaaa"` em `certification_type`              | Corrigido             |
| 3   | "Texto esperado" traz 3 informacoes diferentes      | `expected_cert_text` caia para `certification_type` quando a coluna V estava vazia     | Corrigido             |
| 4   | Coluna SKU traz EANs                                | 5 linhas da aba Encerramentos tem codigo de barras na coluna SKU                       | Corrigido             |
| 5   | Coluna "Vencido" no relatorio                       | —                                                                                      | Removida              |
| 6   | Faltam colunas G e H da aba Encerramentos           | Nunca foram lidas                                                                      | Adicionadas           |
| 7   | Falta identificar trava de faturamento              | Dado existia em `cert_certificates.linx_detail`, sem exposicao                         | Adicionadas 2 colunas |
| 8   | 100400496 "nao conforme" e marca errada             | Coluna MARCA da planilha trazia o FORNECEDOR                                           | Corrigido             |
| 9   | PI7560Y "nao conforme" dentro do prazo              | `"exclu" in texto` casava com "excluido e incluido novamente"                          | Corrigido             |
| 10  | Estoque do painel != relatorio != WMS               | Tres causas distintas (ver abaixo)                                                     | Corrigido             |

## Layout real da planilha (conferido 2026-08-07)

Abas `Imaginarium` e `Puket` (identicas, A..W):

| Col | Cabecalho            | Uso                                                    |
| --- | -------------------- | ------------------------------------------------------ |
| C   | CODIGO               | `sku`                                                  |
| F   | NOME                 | `name`                                                 |
| H   | TIPO DE CERTIFICACAO | `certification_type`                                   |
| J   | STATUS               | `sheet_status` (log multilinha, mais recente primeiro) |
| P   | Numero Certificado   | `numero_certificado` **(novo)**                        |
| U   | SITUACAO             | `situacao` **(novo)**                                  |
| V   | Descricao E-commerce | `expected_cert_text` / `ecommerce_description`         |

Aba `Encerramentos`:

| Col | Cabecalho         | Uso                                     |
| --- | ----------------- | --------------------------------------- |
| A   | CERTIFICADO       | liga com a coluna P das abas de produto |
| B   | SKU               | `sku` (5 linhas trazem EAN)             |
| G   | PRAZO FINAL VENDA | `sale_deadline` / `sale_deadline_date`  |
| H   | STATUS            | `encerramento_status` **(novo)**        |
| J   | MARCA             | `brand`                                 |

Valores reais da coluna H (389 linhas): `Comerciacao Permitida` (203),
`Vencido - Venda Bloqueada` (178), `Venda ate fim do lote` (7),
`Vencido - Venda Bloqueada (Recall)` (1).

> **Atencao ao pedido original.** O pedido dizia "colunas G e H ... mostram se a
> venda esta bloqueada ou permitida e a coluna H o prazo final de venda". Na
> planilha e o inverso: **G** e a data e **H** e bloqueada/permitida. As duas
> foram adicionadas, cada uma com o conteudo que realmente tem.

> **Ponto que precisa de confirmacao.** O pedido diz "coluna tipo de
> certificacao — usar coluna P". A coluna P chama-se **"Numero Certificado"**;
> quem tem o tipo de certificacao e a **coluna H**. O relatorio passou a trazer
> as **duas** colunas separadas (`Tipo Certificacao` da H, `Numero Certificado`
> da P), para nao perder informacao em nenhuma das duas leituras. Se a intencao
> era substituir uma pela outra, e uma linha de mudanca.

## Bugs de status

### 100400496 — marca com nome do fornecedor

A coluna A (MARCA) da aba Puket trazia `Kayuan` em 1 das 111 linhas — `Kayuan` e
o **fornecedor** (coluna E). O sync usava a coluna A como marca, entao o produto
chegava ao portal com `brand = 'Kayuan'`, `get_vtex_config('Kayuan')` devolvia
`None` e a validacao gravava `API_ERROR: No VTEX store configured` — o que o
painel exibia como "Nao conforme".

A marca passou a vir da **aba**, nunca da coluna A. Verificado contra a VTEX real:

```
marca='Kayuan'  status=API_ERROR  score=0.0
marca='Puket'   status=OK         score=0.95
                url=https://www.puket.com.br/fone-de-ouvido-unicornio-aloha-100400496-727/p
```

### PI7560Y — "excluido e incluido novamente" lido como exclusao

`sheet_status` = `"27/10/25 - Item excluido e incluido novamente com o novo nome."`
A regra `if "exclu" in texto_inteiro: return "ENCERRADO"` tratava a **reinclusao**
como exclusao terminal, e `derive_within_sale_deadline` retornava `False` pelo
mesmo motivo — resultado: Encerrado + Nao conforme com a venda liberada.

`_is_sku_excluded` agora percorre o historico da entrada mais recente para a mais
antiga e, na primeira que fala de exclusao, verifica se a mesma entrada tambem
fala de inclusao.

Alem disso, as **28 linhas** da aba Encerramentos que tem veredito na coluna H e
**nenhuma data** na coluna G eram totalmente descartadas pelo sync (que exigia
data). PI7560Y e uma delas. A coluna H passou a ser autoritativa.

### PI7223Y — `is_expired` apagado pela ordem do upsert

O sync gravava Encerramentos primeiro e Ativos depois, e a linha de Ativos vinha
com `is_expired = FALSE` fixo, apagando o vencimento que a linha de Encerramentos
tinha acabado de gravar. PI7223Y ficava `is_expired = false` no banco com prazo
24/07/2026 vencido e a planilha dizendo "Vencido - Venda Bloqueada".

O sync agora tem duas passadas explicitas — cadastro e encerramento — e cada uma
escreve apenas as colunas da sua aba.

## Estoque

### Causa 1 — o sync nunca rodava

`cert_stock` inteira (33.416 linhas) datava de **23/03/2026**. Existe um unico
agendamento em `cert_schedules` ("Validacao Diaria", `0 6 * * *`) e ele so roda a
validacao VTEX; `/api/sync-stock` so era chamado a mao. O sync de estoque passou
a rodar junto do caminho `source="sheets"` (agendamento diario e "rodar agora").

### Causa 2 — painel e relatorio somavam diferente

|           | Formula                                                         | PI7223Y |
| --------- | --------------------------------------------------------------- | ------- |
| Painel    | `available or quantity` (o `or` do Python trata 0 como ausente) | **462** |
| Relatorio | `COALESCE(available, quantity)`                                 | **444** |

A area `CD EXPEDICAO` tem `available = 0` e `quantity = 18` (tudo reservado): o
painel contava 18, o relatorio contava 0. Os dois passaram a usar
`summarize_stock_rows`, que soma **`available`** — "disponivel para venda", que e
o numero comparado com o WMS. `quantity` continua no detalhe por deposito.

### Causa 3 — colisoes de chave perdiam estoque

- **WMS:** a query do Oracle agrupa por `(CD_PRODUTO, AREA, SITUACAO)`, mas a
  chave unica de `cert_stock` e `(sku, source, warehouse)` — sem SITUACAO. Eram
  **360 pares (sku, area)** com mais de uma situacao, e o `ON CONFLICT` fazia a
  ultima **sobrescrever** as demais.
- **E-commerce:** `estoque_produtos` tem uma linha por `(PRODUTO, COR_PRODUTO)` —
  10.117 linhas para 9.923 produtos na Puket. As cores colidiam na mesma chave e
  o painel mostrava o estoque de **uma cor**, nao o do produto.

Ambos passaram a ser agregados antes do upsert.

### Causa 4 — WMS identifica o item pelo codigo de barras

Dos 35.361 registros do WMS, **30.792** vem com EAN e so 3.760 com o codigo
`PIxxxxY`. Como `cert_products.sku` guarda o codigo de produto, o join so
alcancava a Imaginarium. Traduzindo via `PRODUTOS_BARRA` do Linx:

| Marca           | Antes     | Depois      |
| --------------- | --------- | ----------- |
| Imaginarium     | 149/277   | 149/277     |
| Puket           | **1/223** | **108/223** |
| Puket Escolares | **0/162** | **115/162** |

O mesmo mapa normaliza os 5 EANs da coluna SKU da aba Encerramentos
(`7909692117610 -> 100400416` etc.). Falha de conexao com o Linx **nao** derruba
o sync: o codigo cru segue e a ocorrencia vai para o log.

## Colunas do relatorio de produtos

`SKU · Nome · Marca · Status Certificacao · Status E-commerce · Motivo
(E-commerce) · Status Licenciamento · Tipo Certificacao (H) · Numero Certificado
(P) · Texto Esperado (V) · Texto Encontrado · Pontuacao · URL · Prazo Final Venda
(G) · Situacao da Venda (H) · Licen. - Prazo · Trava Fat. Certificacao · Trava
Fat. Licenciamento · Estoque CD · Estoque E-commerce · Total Estoque · Estoque
Atualizado Em`

Removida: **Vencido**.

As travas de faturamento saem de `cert_certificates.linx_detail`, por campo
(`validade_certificado` -> certificacao, `vencimento_licenciamento` ->
licenciamento), lendo o certificado mais recente de cada SKU. Rotulos: `Sim
(dd/mm/aaaa)`, `Nao - escrita no Linx desabilitada`, `Nao - erro na gravacao`,
`Nao - sem data cadastrada`, `Sem certificado cadastrado`.

## Validacao

- `pytest tests/ -q` -> **448 passed** (eram 400; +48 novos).
- `ruff check app/ tests/` -> All checks passed.
- `npm run typecheck` -> ok (api + web).
- `vitest run src/features/certificacoes` -> 22 passed.
- Verificacao read-only contra producao confirmou os tres SKUs:

```
100400496  marca=Puket        cert=ATIVO      comercializacao=LIBERADA
PI7223Y    venda bloqueada    cert=ENCERRADO  comercializacao=ENCERRADA  is_expired=True
PI7560Y    venda permitida    cert=ATIVO      site=CONFORME  comercializacao=DENTRO_PRAZO
```

## Pendencias

1. **Deploy nao foi feito.** O codigo esta no working tree; producao segue com a
   versao antiga. Depois do deploy e preciso rodar um sync completo
   (`POST /api/sync-sheets` + `POST /api/sync-stock`) para os dados refletirem
   as correcoes.
2. **41 produtos ativos estao sem a "Descricao E-commerce" (coluna V)** na
   planilha. Com a correcao, esses saem com "Texto Esperado" vazio e caem em
   `NAO_CONFORME` com a frase "Frase de certificacao obrigatoria ausente no
   cadastro" quando sao regulados. Isso e fiel a planilha — mas alguem do time
   fiscal precisa preencher a coluna V.
3. **Confirmar coluna P vs H** para "Tipo de certificacao" (ver acima).
4. **Agendamento proprio para estoque.** Hoje ele pegou carona no cron da
   validacao (uma vez por dia, 06:00). Se o time precisar de estoque mais fresco,
   vale um `cert_schedules` com tipo de job proprio — hoje a tabela nao tem
   coluna de tipo.

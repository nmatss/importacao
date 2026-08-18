# Status — Certificacao: Colunas, Descricao E Estoque — 2026-08-17

## Objetivo

Validar o retorno da Leticia sobre as colunas da planilha, corrigir a origem do
tipo e da descricao no relatorio e conferir o estoque do SKU `PI7223Y`
diretamente nas fontes.

## Colunas Confirmadas

### Imaginarium E Puket

- H: Tipo de certificacao.
- P: Numero certificado.
- V: Descricao E-commerce usada como texto esperado na comparacao com o site.

O relatorio de produtos mantem Tipo e Numero em colunas separadas, conforme a
confirmacao da Leticia.

### Encerramentos

- G: Prazo final de venda.
- H: Situacao bloqueada/permitida.

O codigo e o relatorio ja usavam o conteudo real nessa ordem; nenhuma inversao
foi necessaria.

### Puket Escolares

Layout atual conferido diretamente na planilha:

| Coluna | Conteudo                                    |
| ------ | ------------------------------------------- |
| C      | Categoria do produto (`ESTOJO`/`LANCHEIRA`) |
| D      | Tipo de certificacao                        |
| E      | Numero do certificado                       |
| H      | Status                                      |
| I      | Descricao E-commerce                        |

O resolvedor procurava o candidato generico `tipo`, encontrava C por igualdade
exata e gravava a categoria como tipo de certificacao. A configuracao foi
corrigida para procurar especificamente `TIPO DE CERTIFICACAO`, com fallbacks
D/E/H/I alinhados ao layout atual.

## Descricao E-commerce E Relatorios

A comparacao com a VTEX ja priorizava a Descricao E-commerce correta. Havia,
porem, um erro de auditoria no relatorio de validacao: o JSON/XLSX chamava o
`certification_type` de `Texto Esperado`, mesmo quando a comparacao tinha usado
a descricao da coluna V/I.

O relatorio de validacao agora preserva campos separados:

- `Tipo Certificacao`: H para Imaginarium/Puket; D para Puket Escolares.
- `Texto Esperado`: V para Imaginarium/Puket; I para Puket Escolares.

### Contagem Atual Da Planilha

| Aba             | Entradas expandidas | SKUs unicos | Vazios brutos | SKUs efetivamente vazios |
| --------------- | ------------------: | ----------: | ------------: | -----------------------: |
| Imaginarium     |                 294 |         277 |             8 |                        6 |
| Puket           |                 111 |         109 |            10 |                        8 |
| Puket Escolares |                 162 |         162 |             0 |                        0 |
| Total           |                 567 |         548 |            18 |                       14 |

Os 41 itens eram a fotografia de 07/08. Desde entao 23 ocorrencias foram
preenchidas. Restam 14 SKUs efetivamente sem descricao e eles dependem de
preenchimento fiscal, nao de correcao de coluna.

Ha 15 SKUs com descricoes conflitantes entre ocorrencias duplicadas (13
Imaginarium e 2 Puket). Hoje vale a ultima ocorrencia; falta alerta explicito
para conflito de cadastro.

O ultimo relatorio de produtos ja tinha 162/162 escolares com Texto Esperado,
mas mostrava 86 `ESTOJO` e 76 `LANCHEIRA` em Tipo Certificacao. Isso confirma que
o problema das lancheiras/estojos era tipo/serializacao do relatorio, nao falta
da descricao em I.

## PI7223Y Contra As Fontes

Consulta read-only direta ao Oracle WMS em 17/08/2026, por volta de 16:29 BRT:

| Fonte/area                           | Fisico | Reservado | Transito | Disponivel |
| ------------------------------------ | -----: | --------: | -------: | ---------: |
| WMS Biguacu / EXPEDICAO              |      7 |         7 |        0 |          0 |
| ERP Imaginarium / E-commerce Extrema |     28 |         0 |        0 |         28 |

Conclusao: `0 CD + 28 E-commerce` confere. O item nao sumiu do WMS; as sete
unidades fisicas estao integralmente reservadas, portanto o disponivel para
venda e zero.

Para eliminar a ambiguidade, painel e XLSX passaram a rotular o total como
`CD disponivel`. Mesmo quando o disponivel e zero, o painel conserva o detalhe
clicavel e mostra `Disponivel / Fisico` por localizacao (neste caso `0 / 7`).

O cache do dia foi sincronizado as 06:00:20 BRT e coincidia com as consultas
diretas. Nao foi disparado novo sync nem houve escrita em WMS/ERP/planilha.

## Alteracoes E Testes

- Layout escolar corrigido em `apps/cert-api/app/services/erp_service.py`.
- Contrato JSON do relatorio corrigido em
  `apps/cert-api/app/routes/certifications.py`.
- XLSX de validacao separa tipo e texto esperado em
  `apps/cert-api/app/services/report_service.py`.
- Painel distingue estoque disponivel de fisico em
  `apps/web/src/features/certificacoes/CertProdutosPage.tsx`.
- Testes sentinela cobrem C versus D, descricao I, serializacao JSON, XLSX e o
  caso real `available=0 / quantity=7`.

## Gate De Volume No Sync De Estoque

O risco `ALTO` "um snapshot de fonte vazio sem excecao ainda pode substituir o
cache" foi fechado em `apps/cert-api/app/services/wms_service.py`.

O sync era um `DELETE FROM cert_stock WHERE source = X` seguido do `INSERT` do
que veio agora, sem nenhuma conferencia de volume. Uma consulta que devolvesse
zero linha **sem levantar excecao** — sessao sem permissao, filtro que nao casa
nada, mapa de barcode que nao traduziu nada — apagava o estoque inteiro daquela
fonte e deixava todo SKU com 0 no CD. E o mesmo sintoma que a Leticia relatou
em `PI7223Y` ("o item sumiu do WMS"), mas na escala da base toda, e sem nada no
log que o diferenciasse de um dia de estoque realmente baixo.

`_assert_snapshot_plausible` roda dentro da transacao, **antes** do `DELETE`:

- snapshot vazio contra qualquer volume gravado -> recusa;
- queda acima de `CERT_STOCK_SYNC_MAX_DROP_PCT` (padrao 50%) -> recusa;
- primeira carga da fonte (nada gravado) -> passa, senao o bootstrap travava;
- `CERT_STOCK_SYNC_FORCE=1` -> saida manual deliberada;
- valor invalido em `CERT_STOCK_SYNC_MAX_DROP_PCT` cai no padrao em vez de
  desligar o gate.

A recusa levanta `StockSnapshotRejectedError`, e o rollback da transacao
preserva o snapshot anterior. Ela e capturada separadamente da falha de
conexao e logada como `error`, porque nao e indisponibilidade: a fonte
respondeu, com volume incompativel. Estoque velho e ruim; estoque zerado por
engano e pior, porque se apresenta como fato.

Testes: `apps/cert-api/tests/test_stock_snapshot_guard.py`, 14 casos.

## Riscos Residuais

- `MEDIO`: 14 SKUs ativos continuam sem Descricao E-commerce na fonte. Depende
  de preenchimento do time fiscal, nao de codigo.
- `MEDIO`: 15 SKUs duplicados tem descricao conflitante e usam last-write-wins,
  sem alerta de conflito de cadastro.
- `ALTO`: estoque tem apenas sincronizacao diaria e nenhum SLA bloqueante de
  frescor. O gate acima impede o zero falso, mas nao torna o dado mais novo.
- Publicado em producao em 17/08/2026 as 21:31 BRT (SHA `ce70f41`), 8/8 etapas
  do `deploy.sh` OK. Nenhum sync de estoque foi disparado manualmente; o gate de
  volume so age na proxima execucao do cron.

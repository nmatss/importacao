# Cadastro de Certificado + Escrita no Linx (PROP_PRODUTOS)

> Status: **LIGADO EM PRODUÇÃO** desde 2026-07-16 (`LINX_WRITE_ENABLED=true` e
> `LINX_SKU_IS_PRODUTO=true` no SOPS, commit `edd3117`, issue #62 fechada).
> Schema **confirmado** contra as duas bases em 2026-07-16 (§6). Credenciais por
> marca ativas (atenção: `ERP_*_USER` ainda é a conta pessoal do Nicolas — migrar
> para conta de serviço segue pendente).

Permite que a equipe cadastre certificados pelo painel de Certificações, vincule os
produtos (SKUs) de cada certificado e, quando o certificado/item está **ENCERRADO**,
**faz upsert do FIM DE VENDA na propriedade de certificação do produto no Linx** (SQL
Server) da marca correspondente.

> **O que o portal grava hoje (revisado em 2026-09-18, conferido no código):**
> somente o **fim de venda** (trava de faturamento), na propriedade `00106`
> (Imaginarium) / `00224` (Puket). A **validade do certificado fica só no portal** e o
> **licenciamento (`00107`/`00225`) nunca é escrito** — o cadastro recusa o campo (400) e
> `write_certificate_to_linx` manda `None` para essa propriedade. A **carga em lote**
> (`sync_prazo_venda_to_linx` com `dry_run=False` / `--apply`) está **bloqueada no
> código**: só o dry-run roda. Versões anteriores deste documento diziam o contrário.

---

## 1. Objetivo

Para cada produto de Imaginarium / Puket vinculado a um certificado **encerrado**, gravar
**uma** propriedade no Linx — o fim de venda:

| Campo (portal)              | Propriedade Linx — Puket | Propriedade Linx — Imaginarium | O portal grava?                                                      |
| --------------------------- | ------------------------ | ------------------------------ | -------------------------------------------------------------------- |
| Fim de venda (trava)        | `00224`                  | `00106`                        | **Sim**, só com situação efetiva ENCERRADO e data real               |
| Validade do Certificado     | —                        | —                              | **Não.** Fica só no portal (decide manutenção/encerramento)          |
| Vencimento do Licenciamento | `00225`                  | `00107`                        | **Não.** Somente leitura; o dono é o time de Produto, direto no Linx |

> O nome histórico da propriedade `00106`/`00224` no Linx é "VALIDADE DO CERTIFICADO", mas
> desde a decisão D11 (§6) ela tem **um** significado: fim de venda. Era a validade gravada
> ali que travava produto com certificado ativo (caso PI5558Y).

Regra de negócio: **certificado ATIVO não tem fim de venda**. O fim de venda só existe
quando o certificado — ou um item dele — é ENCERRADO. Para item ativo nada é enviado ao
Linx e o resultado é `skipped` (ver `linx_status` em §4).

O valor gravado é a data (texto, `dd/mm/AAAA` por padrão) na coluna de valor de
`PROP_PRODUTOS`. Se a propriedade não existe para o produto → **INSERT**; se existe com valor
diferente → **UPDATE**; se já bate → **nada** (`unchanged`).

---

## 2. Arquitetura e fluxo

```
Painel (apps/web)                     cert-api (FastAPI)                 Bancos
─────────────────                     ──────────────────                 ──────
CertCadastroPage
        ├────GET───────────────▶  /api/certificates/linx-lookup
        │                             ├─ resolve SKU → produto
        │                             └─ SELECT props atuais ──────────▶ SQL Server (Linx)
        │                                  (pré-preenche sem gravar)
        │
        └──multipart (form+PDF)──▶ POST /api/certificates
                                      │
                                      ├─▶ valida campos e o PDF (nada gravado ainda)
                                      ├─▶ toma o lock de vínculo (409 se ocupado)
                                      ├─▶ prévia dos SKUs: se NENHUM pode ser vinculado → 400
                                      ├─▶ INSERT cert_certificates ─────▶ PostgreSQL (auditoria)
                                      │     linx_status = 'pending'   (nº repetido → 409)
                                      ├─▶ só então salva o PDF em CERTS_DIR (disco)
                                      │
                                      └─▶ para CADA SKU: linx_service.write_certificate_to_linx()
                                            ├─ _brand_linx(brand)  → host/db/códigos
                                            ├─ resolve_produto_codigo(sku) → código base
                                            ├─ item ATIVO → nada a gravar (`skipped`)
                                            └─ item ENCERRADO → upsert do fim de venda ─▶ SQL Server (Linx)
                                                 (licenciamento: nunca)                    PROP_PRODUTOS
                                          INSERT cert_certificate_items (um por SKU)
                                      ◀── UPDATE cert_certificates
                                            linx_status = applied|skipped|pending|disabled|error
                                          (nenhum SKU vinculado → certificado desfeito, 400)
```

**Bancos envolvidos:**

| Banco                    | Onde                                      | Papel                                             |
| ------------------------ | ----------------------------------------- | ------------------------------------------------- |
| PostgreSQL (cert-api)    | `cert_certificates`                       | Fonte de verdade do portal + auditoria da escrita |
| SQL Server — Puket       | `DB_puket` @ db01.grupounico.com          | Linx Puket (props 00224/00225)                    |
| SQL Server — Imaginarium | `Grupo_Imaginarium` @ db02.grupounico.com | Linx Imaginarium (props 00106/00107)              |

Puket Escolares usa o **mesmo** Linx/códigos da Puket.

---

## 3. Componentes (arquivos)

### Backend — `apps/cert-api`

- `app/config.py` — bloco `LINX_*`: switch `LINX_WRITE_ENABLED`, `LINX_BRANDS`
  (host/db/**credenciais**/códigos por marca) e `LINX_SCHEMA` (nomes de tabela/coluna,
  parametrizáveis por env).
- `app/db/sqlserver.py` — `_ident` (guarda de identificador), `_brand_linx`, `_connect`,
  `resolve_produto_codigo`, `upsert_produto_propriedade`.
- `app/services/linx_service.py` — orquestra a escrita do fim de venda (única propriedade
  gravada), formatação de data, consulta read-only para pré-preenchimento e a política
  fail-closed. O licenciamento aparece na leitura, nunca na escrita.
- `app/routes/certificates.py` — endpoints REST (cadastro, itens, restrição por item, carga
  em lote `SKU;data`, retry) + upload/validação de PDF.
- `app/db/postgres.py` — cria `cert_certificates` e `cert_certificate_items` em
  `ensure_tables()`. As colunas de restrição por item e a tabela
  `cert_certificate_item_restriction_events` vêm da migration explícita
  `sql/20260912_certificate_item_restrictions.sql`.
- `app/main.py` — registra o router `certificates`.
- `sql/linx_discovery.sql` / `scripts/linx_discovery.py` — **descoberta read-only** (ver §6).
- `tests/test_linx_service.py` — testes de unidade (datas, fail-closed, marca, guarda SQL,
  insert/update/unchanged do upsert, credenciais por marca).

### Frontend — `apps/web`

- `src/features/certificacoes/CertCadastroPage.tsx` — formulário (com **Situação do
  certificado**: o fim de venda só habilita quando Encerrado), consulta Linx,
  pré-preenchimento, lista de recentes e o painel de produtos do certificado (vínculo em
  massa, encerramento por item e carga em lote `SKU;data`).
- `src/features/certificacoes/CertProdutoDetailPage.tsx` — exibe número/tipo da
  planilha e as duas propriedades atuais do Linx.
- `src/shared/lib/cert-api-client.ts` — `createCertificate`, `fetchCertificates`,
  `lookupCertificateLinx`, `retryCertificateLinx`, `linkCertificateItems`,
  `batchCertificateItems`, `updateCertificateItemRestriction`, `removeCertificateItem`,
  download de PDF + tipos.
- `src/app/routes.tsx` — rota `/certificacoes/cadastro`.
- `src/shared/components/CertificacoesLayout.tsx` — item de menu "Cadastrar Certificado".

---

## 4. API

Todas sob o prefixo de proxy `/cert-api` no painel.

| Método   | Rota                                             | Descrição                                                                           |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `POST`   | `/api/certificates`                              | Cadastra (multipart: campos + PDF), vincula os SKUs e envia o fim de venda. 30/min. |
| `GET`    | `/api/certificates`                              | Lista paginada (filtros `sku`, `brand`, `numero`, `situacao`, `linx_status`).       |
| `GET`    | `/api/certificates/linx-lookup`                  | Resolve SKU e lê as props atuais no Linx (nunca grava). 60/min.                     |
| `GET`    | `/api/certificates/{id}`                         | Detalhe + itens ativos.                                                             |
| `GET`    | `/api/certificates/{id}/pdf`                     | Download do PDF anexado.                                                            |
| `POST`   | `/api/certificates/{id}/items`                   | Vínculo em massa de SKUs (lista simples; `dry_run` é o padrão). 30/min.             |
| `POST`   | `/api/certificates/{id}/items/batch`             | Carga em lote `SKU` / `SKU;data` com prévia e erro por linha (abaixo). 30/min.      |
| `PATCH`  | `/api/certificates/{id}/items/{sku}/restriction` | Encerra/herda UM item (local, auditado; nunca chama o Linx). 30/min.                |
| `DELETE` | `/api/certificates/{id}/items/{sku}`             | Remove o vínculo (soft delete). **Não** apaga a data já gravada no Linx.            |
| `POST`   | `/api/certificates/{id}/retry-linx`              | Reprocessa a escrita no Linx, item a item. 30/min.                                  |
| `DELETE` | `/api/certificates/{id}`                         | Exclui certificado **sem** itens (administrativo).                                  |

**Campos do `POST /api/certificates` (form-data):** `sku` e/ou `skus` (lista, um por
linha)\*, `brand`\*, `situacao` (`ATIVO` padrão | `ENCERRADO`), `validade_certificado`,
`fim_venda`, `numero_certificado`, `ocp`, `orgao_certificador`, `created_by`, `pdf`
(arquivo). Exige ao menos um SKU, marca e **ao menos uma data**. Regras:

- `fim_venda` só é aceito com `situacao=ENCERRADO` (com ATIVO → 400 "Certificado ativo nao
  possui fim de venda"). A tela manda `situacao` sempre; o contrato tela↔API é o arquivo
  `apps/cert-api/tests/fixtures/certificate_create_contract.json`, lido pelo vitest e pelo
  pytest.
- `vencimento_licenciamento` preenchido → **400** (somente leitura).
- A lista de SKUs aceita **só SKUs**: data colada junto (`PI7001Y;30/10/2026`) → 400, em vez
  de gravar a data como se fosse um SKU. Data por produto é a carga `SKU;data`.
- Nenhum SKU vinculável (todos em outro certificado ativo, ou nenhum existe no Linx) → **400**
  e o certificado **não fica gravado**. Lock de vínculo ocupado → **409** antes de gravar.
- Número de certificado repetido para a marca (índice único) → **409**, sem PDF em disco.

**`linx_status`:** `applied` (ao menos uma propriedade gravada) · `skipped` (Linx ligado e
produto encontrado, mas **nada a gravar** — item/certificado ativo) · `pending` (aguarda
envio: restrição alterada, lote incompleto, encerrado sem data) · `disabled` (Linx off) ·
`error` (falhou — ver `linx_error`/`linx_detail`). No resumo de um lote vence o pior:
`error` > `pending` > `disabled` > `applied` > `skipped`.

### Carga em lote `SKU;data` — `POST /api/certificates/{id}/items/batch`

Pedido do time fiscal (17/09/2026): informar uma lista de produtos e suas respectivas datas
pela tela. Corpo JSON:

```json
{
  "linhas": ["PI5555Y;29/10/2026", "PI7001Y"],
  "motivo": "Encerramento aprovado pelo fiscal em 17/09",
  "encerrar_itens_com_data": true,
  "dry_run": true
}
```

- Uma linha = `SKU` (só vincula) ou `SKU;data` (**encerra aquele item** com aquele fim de
  venda). Separador `;`, TAB ou vírgula; data `dd/mm/aaaa` ou ISO, sempre pelo parser único
  `parse_data_real` (a sentinela `01/01/1900` nunca é data).
- A validação é **do servidor e por linha** (`linhas[].status = "erro"`, com `linha`,
  `conteudo` e `mensagem`): data inválida, SKU vazio, token com cara de data no lugar do SKU,
  SKU repetido com datas diferentes, data sem `encerrar_itens_com_data` (item ativo não tem
  fim de venda), SKU novo que pertence a outro certificado ativo. Teto: 500 linhas.
- **Tudo-ou-nada na validação:** com uma linha em erro, `valid=false` e nada é gravado;
  pedir gravação assim devolve **422**. `dry_run=true` (padrão) é a prévia obrigatória.
- `motivo` é único para o lote e vai para o evento de auditoria
  (`cert_certificate_item_restriction_events`) de cada item alterado.
- Item já vinculado fica `pending` (mesma regra do PATCH: o envio ao Linx é pelo "Reenviar
  ao Linx"). SKU novo segue o vínculo simples: tenta o Linx na hora, já com a data do item;
  SKU que o Linx não conhece volta como `falhou` na própria linha e não é vinculado.
- Resposta: `dry_run`, `valid`, `total_linhas`, `resumo` (contagem por `vincular`,
  `vincular_e_encerrar`, `encerrar`, `sem_alteracao`, `erro`), `linhas[]` (`linha`,
  `conteudo`, `sku`, `fim_venda`, `acao`, `status`, `mensagem`, `aviso`) e, só na gravação,
  `items` (itens ativos do certificado).
- **Autorização:** rota desconhecida cai em `cert.admin` (fail-closed) em
  `apps/api/src/modules/auth/cert-api-access.ts`. Para o analista usar, a rota precisa
  entrar em `isOperatePath`, ao lado de `.../items`.

### Tabelas (PostgreSQL)

`cert_certificates`: `id, sku (legado), brand, produto_codigo, validade_certificado,
fim_venda, situacao, vencimento_licenciamento (nunca preenchido pelo cadastro),
numero_certificado, ocp, orgao_certificador, pdf_filename, linx_status, linx_error,
linx_detail (jsonb), linx_applied_at, created_by, created_at, updated_at`. Índice único
parcial `(brand, numero_certificado)`.

`cert_certificate_items`: um produto por linha (`certificate_id`, `sku`, `linx_*`,
`added_*`, `removed_*` para o soft delete) + restrição por item (`situacao`, `fim_venda`,
`restriction_updated_*`; `NULL` = herda o certificado).

`cert_certificate_item_restriction_events`: auditoria antes/depois de cada mudança de
restrição (`item_id, before_state, after_state, reason, actor, created_at`).

---

## 5. Segurança e robustez (decisões de projeto)

- **Fail-closed:** nada é escrito no Linx enquanto `LINX_WRITE_ENABLED=false`. O certificado
  fica salvo no portal com `linx_status=disabled`. Evita gravar em produção com schema não confirmado.
- **SQL-injection-proof:** nomes de tabela/coluna vêm **apenas** de config/env e passam por
  `_ident` (`^[A-Za-z0-9_]+$`); produto, código de propriedade e valor são **sempre bind params**.
  Nenhum input de request alcança um identificador.
- **Marca fail-closed:** somente `imaginarium`, `puket` e `puket escolares`
  (incluindo o slug com underscore) são aceitas. Substrings como `notpuket` não
  selecionam mais uma base produtiva.
- **Consulta segura:** a rota de lookup é `GET`, não persiste dados, tem limite de
  tamanho nos parâmetros, rate limit e resposta de erro genérica. Exceções do driver
  SQL Server não expõem host/login ao browser nem são copiadas para `linx_error`.
- **Pré-preenchimento conservador:** datas Linx e número do certificado da planilha
  preenchem somente campos vazios; valor digitado pelo operador não é substituído.
  A sentinela Linx `01/01/1900` é tratada como campo vazio.
- **Upsert seguro (anti-race + anti-trigger):** lê o valor atual com
  `SELECT … WITH (UPDLOCK, HOLDLOCK)`, o que serializa o caso "linha ausente" (dois cadastros
  simultâneos do mesmo par produto/propriedade não inserem em duplicidade), e então decide:
  **insere** se a propriedade falta (informando `ITEM_PROPRIEDADE` — PK, `NOT NULL` sem default),
  **atualiza** se o certificado traz valor diferente, ou devolve **`unchanged`** se já bate.
  O no-op importa: `PROP_PRODUTOS` tem trigger ativo no Puket (`LXU_PROP_PRODUTOS`) e reescrever
  valor igual dispararia a replicação do Linx à toa. Tudo em transação manual
  (commit/rollback/close).
- **Resolução SKU→produto fail-closed:** o SKU do portal às vezes é produto+cor+tamanho (grade),
  enquanto a propriedade vive no produto base. Sem a coluna de mapeamento configurada, o resolver
  **recusa gravar** (`raise`) em vez de usar o SKU cru — não polui o ERP com chave inválida.
- **Upload de PDF:** exige extensão `.pdf` **e** assinatura `%PDF-` (magic bytes); limite 15 MB;
  nome no disco derivado de UUID server-side (sem path traversal). O arquivo é validado antes
  e gravado **depois** do INSERT, para que uma falha do banco não deixe PDF órfão.
- **Sem certificado órfão:** o lock de vínculo é tomado antes do INSERT e um cadastro em que
  nenhum SKU é vinculado é recusado/desfeito (o DELETE de limpeza é guardado por
  `NOT EXISTS` em `cert_certificate_items`).
- **Entrada em lote validada no servidor:** as linhas chegam cruas e cada uma é validada no
  cert-api; a tela só exibe o resultado. Texto com cara de data nunca é gravado como SKU.

---

## 6. Go-live: ativar a gravação no Linx

**Descoberta CONCLUÍDA em 2026-07-16** (issue #62, passo 1). Rodada com
`scripts/linx_discovery.py` + probes read-only nas duas bases. O que ficou cravado:

| Item                      | Valor real (as duas bases)                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROP_PRODUTOS`           | `PROPRIEDADE` char(5), `PRODUTO` char(12), `ITEM_PROPRIEDADE` smallint, `VALOR_PROPRIEDADE` varchar(70)                                                                                  |
| **PK de `PROP_PRODUTOS`** | **(`PROPRIEDADE`, `PRODUTO`, `ITEM_PROPRIEDADE`)** — 3 colunas                                                                                                                           |
| `ITEM_PROPRIEDADE`        | `NOT NULL`, **sem default** → todo INSERT precisa informá-la. É o índice de multivalor; as 4 props de certificado são single-valued e usam **item=1** em 100% das 8510 linhas existentes |
| SKU → produto             | O SKU do portal **é** o `PRODUTO` (`070400034`→Puket, `PI4511Y`→Imaginarium) → `LINX_SKU_IS_PRODUTO=true`                                                                                |
| Máscara das props de data | `99/99/9999` → confere com `LINX_DATE_FORMAT=%d/%m/%Y`                                                                                                                                   |
| Valor "vazio" no Linx     | Sentinela `01/01/1900` (não é NULL)                                                                                                                                                      |
| Trigger                   | `LXU_PROP_PRODUTOS` **ativo no Puket**, ausente no Imaginarium → o upsert não reescreve valor igual (`unchanged`) para não disparar replicação à toa                                     |
| Credenciais               | **db01 e db02 têm logins SEPARADOS** — uma credencial só não atende as duas                                                                                                              |

Os defaults do `config.py` para tabela/colunas estavam corretos e foram mantidos.

1. **Configurar** (`.env`, ver `.env.example`):
   ```
   LINX_WRITE_ENABLED=true
   LINX_SKU_IS_PRODUTO=true            # confirmado: SKU do portal == PRODUTO do Linx
   # tabela/colunas: os defaults já batem com o schema real; sobrescreva só se mudar
   # LINX_PROP_TABLE=PROP_PRODUTOS
   # LINX_PROP_COL_PRODUTO=PRODUTO
   # LINX_PROP_COL_PROPRIEDADE=PROPRIEDADE
   # LINX_PROP_COL_VALOR=VALOR_PROPRIEDADE
   # LINX_PROP_COL_ITEM=ITEM_PROPRIEDADE
   # LINX_PROP_ITEM_VALUE=1
   # LINX_DATE_FORMAT=%d/%m/%Y
   # Credenciais POR MARCA (db01 e db02 têm logins distintos):
   ERP_PUKET_USER / ERP_PUKET_PASS
   ERP_IMG_USER / ERP_IMG_PASS
   # ERP_MSSQL_USER / ERP_MSSQL_PASS  # fallback, se um login servir para as duas
   ```
2. **Reprocessar** o que ficou pendente: botão **"Reenviar ao Linx"** na tela (ou
   `POST /api/certificates/{id}/retry-linx`).

> A PK cobre (produto, propriedade) — corrida está protegida pela PK e pelo
> `UPDLOCK, HOLDLOCK` do upsert.

### Não existe "prazo de comercialização" no Linx — o sync reaproveita a prop de validade

Pedido da Lilian em 2026-07-16 (SKU `070400034`). Listadas **todas** as propriedades de
produto das duas bases: as únicas ligadas a certificação são `VALIDADE DO CERTIFICADO` e
`VENCIMENTO DO LICENCIAMENTO`. **Não há propriedade dedicada de prazo de comercialização.**

**Atualização (commits `4148ba8`/`915db83`), corrigida em 2026-09-18:** existe o sync
`sync_prazo_venda_to_linx` (`scripts/sync_prazo_venda_linx.py`), que **compara** o
"PRAZO FINAL VENDA" da aba Encerramentos com a propriedade de certificação
(00224 Puket / 00106 Imaginarium) — reaproveitando a prop existente. Ele roda **somente em
dry-run** (`--list` imprime prazo × valor atual no Linx × ação proposta).

> **`--apply` NÃO grava.** `sync_prazo_venda_to_linx(dry_run=False)` devolve o erro
> "Carga em lote bloqueada: preparar baseline persistida, plano aprovado, conciliacao e
> recuperacao verificadas antes de habilitar apply" e sai sem tocar no Linx
> (`load_gate = BLOCKED_PENDING_REVIEW_AND_RECOVERY`). A flag `--apply` continua existindo
> no script e o texto de ajuda dele ainda fala em gravar — vale o código do serviço.

Mesmo quando a carga for liberada, dois grupos NUNCA serão gravados automaticamente:
`encurta_janela` (prazo da planilha anterior ao do Linx — gravaria tirando dias de venda) e
`ambiguos` (mesmo SKU com prazos divergentes, produto recertificado). O Linx não versiona
`PROP_PRODUTOS`: o relatório JSON antes/depois é evidência de diagnóstico, **não** um
backup nem um caminho de rollback testado.

### Decisão D11 (reunião 11/09/2026): a propriedade é TRAVA, não validade

A propriedade de certificação passa a ter **um** significado: fim de venda (trava de
faturamento). Mudanças já implementadas no código:

- `write_certificate_to_linx` grava em 00106/00224 **somente `fim_venda`**. A validade
  do certificado nunca vai para o ERP (ela serve para decidir manutenção/encerramento).
  Com `situacao='Ativo'`, a gravação é recusada com `bloqueado: certificado ativo` —
  _"os produtos que estão ATIVOS a gente não pode ter data na coluna de certificação"_.
  A rota passa a situação efetiva de cada item, então a guarda dispara de fato; e quando
  nenhum upsert acontece o status é `skipped`, nunca `applied`.
- O licenciamento (00107/00225) **não é gravado pelo portal em nenhum caminho**: o cadastro
  recusa o campo e o alvo `vencimento_licenciamento` de `write_certificate_to_linx` é
  sempre `None`.
- `sync_prazo_venda_to_linx` lê a coluna **U (SITUAÇÃO)** das abas de produto
  (`erp_service.read_situacao_por_sku`) antes de classificar; sem esse mapa nada é
  classificado como gravável. E `dry_run=False` (`--apply`) está **bloqueado no código**
  para qualquer caso, até existir baseline persistida, plano aprovado, conciliação e
  recuperação verificadas.
- Ações novas, todas **sem gravação**: `limpar: ativo` (certificado ativo com data real
  no Linx; valor proposto `01/01/1900`, a sentinela do próprio ERP — executar exige
  autorização explícita e aceite fiscal), `bloqueado: certificado ativo` (ativo, sem
  data no Linx), `dupla certificacao` (o encerramento é de certificado diferente do
  vigente, caso PI6552Y) e `bloqueado: situacao desconhecida`.
- O **relatório antes/depois por SKU é salvo sempre**, dry-run inclusive, em
  `REPORTS_DIR/sync-prazo-linx-{dry-run|apply}-<timestamp>.json`, com situação,
  certificado vigente × certificado do encerramento, validade, valores atuais das duas
  propriedades, valor proposto, trava esperada (menor data real) e ação; mais
  `totais_por_marca` e `diff` (só o que mudaria).
- A **trava esperada** é a MENOR data real entre fim de venda da certificação e fim do
  licenciamento (`derivation.derive_trava_venda`); nulo e ano < 2000 são ausência.

Comando de conferência (somente leitura no Linx, nada é escrito):

```
docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --list
```

A carga "do zero" (zerar e recarregar as propriedades) **não foi executada** e continua
exigindo autorização explícita, aceite fiscal (Eduarda/Odett) e alinhamento com o time
do Linx. Recomendação registrada: recarregar **apenas** a propriedade de certificação;
o licenciamento é mantido pelo time de produto direto no Linx e não deve ser zerado.

---

## 7. Operação / troubleshooting

| Sintoma                                                       | Causa provável                                                         | Ação                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `linx_status=disabled`                                        | `LINX_WRITE_ENABLED=false`                                             | Concluir §6 e reenviar.                                                               |
| `error` "Resolucao SKU->produto nao configurada"              | `LINX_PRODUTO_COL_SKU` vazio e `LINX_SKU_IS_PRODUTO≠true`              | Definir mapeamento (§6).                                                              |
| `error` "SKU não encontrado no Linx"                          | SKU não casa na tabela de produto                                      | Conferir SKU / coluna de busca.                                                       |
| `error` de conexão / `Login failed for user`                  | credencial da marca errada/expirada (db01 e db02 têm logins distintos) | Validar `ERP_PUKET_*` / `ERP_IMG_*` (ou o fallback `ERP_MSSQL_*`) e o acesso ao host. |
| `Cannot insert the value NULL into column 'ITEM_PROPRIEDADE'` | `LINX_PROP_COL_ITEM`/`LINX_PROP_ITEM_VALUE` vazios                     | Restaurar os defaults (`ITEM_PROPRIEDADE` / `1`).                                     |
| `action: unchanged` no detalhe                                | o Linx já tinha esse valor                                             | Esperado — não reescreve para não disparar o trigger `LXU_PROP_PRODUTOS`.             |
| PDF rejeitado                                                 | não é PDF (sem `%PDF-`) ou > 15 MB                                     | Reenviar arquivo válido.                                                              |

---

## 8. Limitações conhecidas / próximos passos

- Schema e escrita estão confirmados e ligados em produção. A auditoria read-only de
  2026-08-26 confirmou conectividade nas duas bases e `LINX_WRITE_ENABLED=true`.
- `write_certificate_to_linx` grava **1 propriedade fixa** (fim de venda, 00106/00224); o
  licenciamento é só leitura e não há suporte a N props.
- A carga em lote planilha→Linx (`--apply`) está bloqueada no código (§6). O caminho para
  atualizar muitos produtos sem a TI é a carga `SKU;data` da tela (§4), que grava no portal
  e deixa o envio ao Linx para o "Reenviar ao Linx".
- PDF é armazenado em disco (`CERTS_DIR`); migrar para Google Drive é possível (cert-api já usa
  service account para Sheets) mas não foi feito.
- Não há edição dos dados do certificado nem exclusão pela UI. A UI cobre cadastro,
  listagem, retry e a gestão dos produtos do certificado (vincular, remover, encerrar item,
  carga `SKU;data`).
- `cert_certificates` registra somente operações feitas pelo formulário. Ela estava
  vazia em 2026-08-26 embora o Linx tivesse datas: não usar essa tabela para inferir
  ausência de trava. Relatórios e telas consultam o próprio Linx.
- Os logins ERP por marca ainda dependem de conta pessoal. Migrar para contas de
  serviço de menor privilégio permanece pendente operacional.

## 9. Preparacao da troca de identidade — 2026-09-06

A consulta somente leitura `IS_SRVROLEMEMBER('sysadmin')` retornou `1` nas duas
conexoes atuais. Ambas tambem possuem `ALTER ANY LOGIN`. Conectividade foi
confirmada sem imprimir identidades ou credenciais. Isso nao autoriza revogar
um login pessoal que pode ser usado por outros consumidores.

A troca deve ocorrer por base, com uma identidade dedicada a Cert-API. O DBA
precisa validar os objetos configurados em `LINX_SCHEMA` e as dependencias do
trigger de `PROP_PRODUTOS`. O codigo em `app/db/sqlserver.py` requer:

| Objeto                             | Permissoes necessarias pelo codigo atual |
| ---------------------------------- | ---------------------------------------- |
| `estoque_produtos`                 | `SELECT`                                 |
| `PRODUTOS_BARRA`                   | `SELECT`                                 |
| Tabela de produtos configurada     | `SELECT`                                 |
| Tabela de propriedades configurada | `SELECT`, `INSERT`, `UPDATE`             |

Nao ha necessidade demonstrada de `DELETE`, `db_owner`, `sysadmin` ou
`ALTER ANY LOGIN` para a aplicacao. Os grants acima sao o ponto de partida;
nao provam que triggers ou ownership chaining funcionarao com uma nova conta.

Procedimento revisavel:

1. Confirmar nome/ownership das duas contas tecnicas e gerar senhas pelo cofre
   corporativo, sem valores em comandos, logs ou Markdown.
2. Criar login e usuario na base correspondente; conceder acesso apenas aos
   objetos efetivamente configurados. Validar permissao efetiva e dependencias
   de triggers antes de qualquer escrita.
3. Executar consulta de estoque, resolucao SKU e leitura das duas propriedades
   com a identidade nova; exigir `sysadmin=0` e `ALTER ANY LOGIN=0`.
4. Atualizar `ERP_PUKET_USER/PASS` ou `ERP_IMG_USER/PASS` pelo SOPS e publicar
   pelo procedimento oficial. Trocar uma base por vez para isolar falhas.
5. Com certificado e SKU aprovados pela area, executar smoke de escrita e
   confirmar valor final e auditoria. Nao usar dado de producao arbitrario nem
   supor que rollback desfaz efeitos de triggers.
6. Retirar a credencial pessoal da configuracao do aplicativo. Revogacao global
   do login depende de inventario dos demais consumidores pelo DBA.

Nenhuma conta foi criada, nenhum grant alterado e nenhum registro Linx foi
escrito nesta verificacao. A execucao depende da identidade/ownership aprovados
e do caso de teste de negocio; o plano operacional e as evidencias ficam na
sessao dotcontext `142282d9-7495-4a36-a16f-12ffe22fdbaa`.

## 10. Decisao posterior do usuario — 2026-09-06

O usuario determinou manter suas credenciais atuais e tratar a migracao de
identidade posteriormente. O procedimento da secao 9 permanece como referencia
futura; nao executar criacao de contas, rotacao ou alteracao de grants nesta
entrega. O risco de privilegios amplos continua conhecido, sem bloquear o deploy
por uma migracao que foi explicitamente adiada.

Consultas autenticadas reais ao endpoint de lookup retornaram HTTP 200 e
`status=found` para Puket e Imaginarium. Nenhuma propriedade foi escrita. O smoke
de cadastro continua dependendo de SKU, marca e datas aprovados pela area fiscal.

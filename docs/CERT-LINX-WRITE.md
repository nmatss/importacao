# Cadastro de Certificado + Escrita no Linx (PROP_PRODUTOS)

> Status: **LIGADO EM PRODUÇÃO** desde 2026-07-16 (`LINX_WRITE_ENABLED=true` e
> `LINX_SKU_IS_PRODUTO=true` no SOPS, commit `edd3117`, issue #62 fechada).
> Schema **confirmado** contra as duas bases em 2026-07-16 (§6). Credenciais por
> marca ativas (atenção: `ERP_*_USER` ainda é a conta pessoal do Nicolas — migrar
> para conta de serviço segue pendente).

Permite que a equipe cadastre certificados pelo painel de Certificações e, ao salvar,
**faz upsert das datas de certificação nas propriedades de produto do Linx** (SQL Server)
da marca correspondente.

---

## 1. Objetivo

Para cada produto de Imaginarium / Puket, gravar duas propriedades no Linx:

| Campo (form)                | Propriedade Linx — Puket | Propriedade Linx — Imaginarium |
| --------------------------- | ------------------------ | ------------------------------ |
| Validade do Certificado     | `00224`                  | `00106`                        |
| Vencimento do Licenciamento | `00225`                  | `00107`                        |

O valor gravado é a data (texto, `dd/mm/AAAA` por padrão) na coluna de valor de
`PROP_PRODUTOS`. Se a propriedade não existe para o produto → **INSERT**; se existe com valor
diferente → **UPDATE**; se já bate → **nada** (`unchanged`).

---

## 2. Arquitetura e fluxo

```
Painel (apps/web)                     cert-api (FastAPI)                 Bancos
─────────────────                     ──────────────────                 ──────
CertCadastroPage  ──multipart──▶  POST /api/certificates
  (form + PDF)                        │
                                      ├─▶ salva PDF em CERTS_DIR (disco)
                                      ├─▶ INSERT cert_certificates ─────▶ PostgreSQL (auditoria)
                                      │     linx_status = 'pending'
                                      │
                                      └─▶ linx_service.write_certificate_to_linx()
                                            ├─ _brand_linx(brand)  → host/db/códigos
                                            ├─ resolve_produto_codigo(sku) → código base
                                            ├─ upsert prop validade  ──┐
                                            └─ upsert prop vencimento ─┴▶ SQL Server (Linx)
                                                                          PROP_PRODUTOS
                                      ◀── UPDATE cert_certificates
                                            linx_status = applied|disabled|error
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
- `app/services/linx_service.py` — orquestra a escrita das 2 propriedades, formatação de
  data e a política fail-closed.
- `app/routes/certificates.py` — endpoints REST + upload/validação de PDF.
- `app/db/postgres.py` — cria a tabela `cert_certificates` em `ensure_tables()`.
- `app/main.py` — registra o router `certificates`.
- `sql/linx_discovery.sql` / `scripts/linx_discovery.py` — **descoberta read-only** (ver §6).
- `tests/test_linx_service.py` — testes de unidade (datas, fail-closed, marca, guarda SQL,
  insert/update/unchanged do upsert, credenciais por marca).

### Frontend — `apps/web`

- `src/features/certificacoes/CertCadastroPage.tsx` — formulário + lista de recentes.
- `src/shared/lib/cert-api-client.ts` — `createCertificate`, `fetchCertificates`,
  `retryCertificateLinx`, `getCertificatePdfUrl` + tipos.
- `src/app/routes.tsx` — rota `/certificacoes/cadastro`.
- `src/shared/components/CertificacoesLayout.tsx` — item de menu "Cadastrar Certificado".

---

## 4. API

Todas sob o prefixo de proxy `/cert-api` no painel.

| Método | Rota                                | Descrição                                                              |
| ------ | ----------------------------------- | ---------------------------------------------------------------------- |
| `POST` | `/api/certificates`                 | Cadastra (multipart: campos + PDF) e grava no Linx. Rate-limit 30/min. |
| `GET`  | `/api/certificates`                 | Lista paginada (filtros `sku`, `brand`, `linx_status`).                |
| `GET`  | `/api/certificates/{id}`            | Detalhe.                                                               |
| `GET`  | `/api/certificates/{id}/pdf`        | Download do PDF anexado.                                               |
| `POST` | `/api/certificates/{id}/retry-linx` | Reprocessa a escrita no Linx. Rate-limit 30/min.                       |

**Campos do `POST` (form-data):** `sku*`, `brand*`, `validade_certificado`,
`vencimento_licenciamento`, `numero_certificado`, `ocp`, `orgao_certificador`,
`created_by`, `pdf` (arquivo). Exige SKU, marca e **ao menos uma data**.

**`linx_status`:** `applied` (gravado) · `pending` (transitório) ·
`disabled` (Linx off) · `error` (falhou — ver `linx_error`/`linx_detail`).

### Tabela `cert_certificates` (PostgreSQL)

`id, sku, brand, produto_codigo, validade_certificado, vencimento_licenciamento,
numero_certificado, ocp, orgao_certificador, pdf_filename, linx_status, linx_error,
linx_detail (jsonb), linx_applied_at, created_by, created_at, updated_at`.

---

## 5. Segurança e robustez (decisões de projeto)

- **Fail-closed:** nada é escrito no Linx enquanto `LINX_WRITE_ENABLED=false`. O certificado
  fica salvo no portal com `linx_status=disabled`. Evita gravar em produção com schema não confirmado.
- **SQL-injection-proof:** nomes de tabela/coluna vêm **apenas** de config/env e passam por
  `_ident` (`^[A-Za-z0-9_]+$`); produto, código de propriedade e valor são **sempre bind params**.
  Nenhum input de request alcança um identificador.
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
  nome no disco derivado de UUID server-side (sem path traversal).

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

**Atualização (commits `4148ba8`/`915db83`):** existe agora o sync
`sync_prazo_venda_to_linx` (`scripts/sync_prazo_venda_linx.py`), que grava o
"PRAZO FINAL VENDA" da aba Encerramentos **na propriedade de VALIDADE DO CERTIFICADO**
(00224 Puket / 00106 Imaginarium) — reaproveitando a prop existente. `dry_run` por
padrão (`--list` imprime prazo × valor atual no Linx × ação); escrever exige `--apply`.
Dois grupos NUNCA são gravados automaticamente: `encurta_janela` (prazo da planilha
anterior ao do Linx — gravaria tirando dias de venda) e `ambiguos` (mesmo SKU com
prazos divergentes, produto recertificado). O relatório JSON do `--apply` é o único
caminho de rollback — o Linx não versiona PROP_PRODUTOS.

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

- Schema de `PROP_PRODUTOS`/`PROPRIEDADE` **confirmado** em 2026-07-16 (§6). Falta só
  ligar `LINX_WRITE_ENABLED` com as credenciais por marca.
- `write_certificate_to_linx` grava **2 propriedades fixas**; não há suporte a N props
  (bloqueado, de todo modo, pela ausência da propriedade de prazo — §6).
- PDF é armazenado em disco (`CERTS_DIR`); migrar para Google Drive é possível (cert-api já usa
  service account para Sheets) mas não foi feito.
- Não há edição/exclusão de certificado pela UI (apenas cadastro, listagem e retry).

# Cadastro de Certificado + Escrita no Linx (PROP_PRODUTOS)

> Status: **implementado, gravação no Linx GATED** (`LINX_WRITE_ENABLED=false`) até a
> descoberta de schema ser confirmada. Branch: `feat/ai-harness-uat-odett`.

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
`PROP_PRODUTOS`. Se a propriedade já existe para o produto → **UPDATE**; senão → **INSERT**.

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
  (host/db/códigos por marca) e `LINX_SCHEMA` (nomes de tabela/coluna, parametrizáveis por env).
- `app/db/sqlserver.py` — `_ident` (guarda de identificador), `_brand_linx`, `_connect`,
  `resolve_produto_codigo`, `upsert_produto_propriedade`.
- `app/services/linx_service.py` — orquestra a escrita das 2 propriedades, formatação de
  data e a política fail-closed.
- `app/routes/certificates.py` — endpoints REST + upload/validação de PDF.
- `app/db/postgres.py` — cria a tabela `cert_certificates` em `ensure_tables()`.
- `app/main.py` — registra o router `certificates`.
- `sql/linx_discovery.sql` — **query de descoberta read-only** (ver §6).
- `tests/test_linx_service.py` — 26 testes de unidade (datas, fail-closed, marca, guarda SQL).

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
- **Upsert seguro (anti-race + anti-trigger):**
  `UPDATE … WITH (UPDLOCK, HOLDLOCK, ROWLOCK)` serializa o caso "linha ausente" (dois cadastros
  simultâneos do mesmo par produto/propriedade não inserem em duplicidade); `SET NOCOUNT ON` +
  `SELECT @@ROWCOUNT` tornam a contagem confiável mesmo se `PROP_PRODUTOS` tiver triggers (comum em Linx).
  Tudo em transação manual (commit/rollback/close).
- **Resolução SKU→produto fail-closed:** o SKU do portal às vezes é produto+cor+tamanho (grade),
  enquanto a propriedade vive no produto base. Sem a coluna de mapeamento configurada, o resolver
  **recusa gravar** (`raise`) em vez de usar o SKU cru — não polui o ERP com chave inválida.
- **Upload de PDF:** exige extensão `.pdf` **e** assinatura `%PDF-` (magic bytes); limite 15 MB;
  nome no disco derivado de UUID server-side (sem path traversal).

---

## 6. Go-live: ativar a gravação no Linx

A gravação só liga após confirmar os nomes reais de coluna (não foram adivinhados).

1. **Descoberta (read-only):** rodar `apps/cert-api/sql/linx_discovery.sql` no SSMS conectado a
   **DB_puket** (db01) e **Grupo_Imaginarium** (db02). Ela revela:
   - colunas e PK de `PROP_PRODUTOS` e `PROPRIEDADE`;
   - o catálogo de `PROPRIEDADE` (confirma 00224/00106… → descrição);
   - colunas candidatas a produto/sku/cor/tamanho para definir o mapeamento.
2. **Configurar** (`.env`, ver `.env.example`):
   ```
   LINX_WRITE_ENABLED=true
   LINX_PROP_TABLE=PROP_PRODUTOS
   LINX_PROP_COL_PRODUTO=...           # coluna do código do produto
   LINX_PROP_COL_PROPRIEDADE=...       # coluna do código da propriedade (00224…)
   LINX_PROP_COL_VALOR=VALOR_PROPRIEDADE
   # mapeamento SKU -> produto:
   LINX_SKU_IS_PRODUTO=false           # true se o SKU já é o código do produto
   LINX_PRODUTO_TABLE=...              # se precisa resolver
   LINX_PRODUTO_COL_CODIGO=...
   LINX_PRODUTO_COL_SKU=...
   LINX_DATE_FORMAT=%d/%m/%Y
   ERP_MSSQL_USER / ERP_MSSQL_PASS     # credenciais de escrita
   ```
3. **Reprocessar** o que ficou pendente: botão **"Reenviar ao Linx"** na tela (ou
   `POST /api/certificates/{id}/retry-linx`).

> Recomendado validar que `PROP_PRODUTOS` tem PK/unique em (produto, propriedade) — a query [3]
> de descoberta mostra a PK. Se não houver, o lock do upsert já protege contra corrida.

---

## 7. Operação / troubleshooting

| Sintoma                                          | Causa provável                                            | Ação                                    |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------- |
| `linx_status=disabled`                           | `LINX_WRITE_ENABLED=false`                                | Concluir §6 e reenviar.                 |
| `error` "Resolucao SKU->produto nao configurada" | `LINX_PRODUTO_COL_SKU` vazio e `LINX_SKU_IS_PRODUTO≠true` | Definir mapeamento (§6).                |
| `error` "SKU não encontrado no Linx"             | SKU não casa na tabela de produto                         | Conferir SKU / coluna de busca.         |
| `error` de conexão                               | credenciais/rede SQL Server                               | Validar `ERP_MSSQL_*` e acesso ao host. |
| PDF rejeitado                                    | não é PDF (sem `%PDF-`) ou > 15 MB                        | Reenviar arquivo válido.                |

---

## 8. Limitações conhecidas / próximos passos

- Nomes de coluna de `PROP_PRODUTOS`/`PROPRIEDADE` **pendentes de confirmação** (§6).
- PDF é armazenado em disco (`CERTS_DIR`); migrar para Google Drive é possível (cert-api já usa
  service account para Sheets) mas não foi feito.
- Não há edição/exclusão de certificado pela UI (apenas cadastro, listagem e retry).

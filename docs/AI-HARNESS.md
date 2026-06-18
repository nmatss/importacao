# Camada de IA — Provider Local/Vertex + Skills + Harness de Confiança

> Estado operacional mais recente (2026-06-18): producao recente usa
> `AI_PROVIDER=ialocal`, `AI_ALLOW_EXTERNAL=false` e `AI_USE_SPECIALIST=1`.
> Vertex continua documentado como caminho recomendado para qualidade/privacidade
> quando houver decisao formal e IAM liberado. Nao trate este documento como
> evidencia de que Vertex esta ativo em producao.

> Como o sistema garante que **tudo que a IA gera e analisa** é confiável. Toda
> extração de documento (Invoice, Packing List, BL, Draft BL) passa por esta
> camada antes de ser persistida ou usada nas validações.

## 1. Provider — Estado Atual E Opcao Vertex

O codigo suporta provider local e Vertex. O estado recente de producao e IA local
via `unico-docintel`, com egress externo bloqueado por default. Vertex AI
(`aiplatform.googleapis.com`) permanece como opcao recomendada quando a decisao
formal for qualidade/privacidade contratual, porque documentos contêm dados
sensiveis (Invoices, CNPJ, BLs, valores comerciais) e Vertex oferece garantia de
**não usar os dados para treino**.

- Implementação: `apps/api/src/modules/ai/providers/vertex.ts` (REST + OAuth2 via Service Account).
- Seleção: `ai/service.ts` — `AI_PROVIDER=ialocal` no estado recente; `AI_PROVIDER=vertex` quando aprovado.
- Validação fail-fast: `shared/config/env.ts` exige `GOOGLE_VERTEX_PROJECT` quando `AI_PROVIDER=vertex`.
- Modelos: `gemini-2.5-flash` → upgrade para `gemini-2.5-pro` só quando a confiança fica baixa.
- Teto de custo: `AI_MONTHLY_BUDGET_USD` (≈ R$150/mês = USD 26) — `ai/cost-tracker.ts`, com alerta aos 80%.
- `cert-api` (Python) **não usa IA** — só scraping VTEX/ERP.
- Saída estruturada: `responseSchema` derivado do Zod (`extraction-schemas.ts`) é enviado ao Vertex — o modelo não pode emitir campos fora do schema.

## 2. Skills — expertise por tipo de documento

`apps/api/src/modules/ai/skills/registry.ts` mapeia cada documento para uma
**skill** coesa = `{ schema (structured output) + verification (receita do harness) }`.
Skills atuais: `invoice`, `packing_list`, `ohbl` (BL Final), `draft_bl`.

`getVerificationConfig(docType)` devolve a receita de verificação que o harness executa.

## 3. Harness de Confiança — verificação determinística pós-extração

`apps/api/src/modules/ai/harness/`. Roda **depois** da extração e **antes** de
confiar. `applyHarness()` (em `ai/service.ts`) é chamado em todos os extractors;
o resultado vira um `_trust` report anexado aos dados (auditável) e rebaixa a
confiança / força revisão humana.

| Camada                          | Arquivo              | O que faz                                                                                                                                                                                                      |
| ------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grounding** (anti-alucinação) | `grounding.ts`       | O valor extraído (nº invoice/BL, container, NCM, CNPJ) **tem que aparecer no texto do documento**. Senão → erro → revisão. Pulado quando o texto-fonte é curto (PDF escaneado), para não gerar falso positivo. |
| **Formato**                     | `format.ts`          | NCM `XXXX.XX.XX`, **container ISO 6346 com check-digit**, **CNPJ com dígito verificador**, datas ISO-8601, moeda USD.                                                                                          |
| **Numérico**                    | `numeric.ts` + skill | Σ(itens, exceto FOC) ≈ FOB declarado; peso líquido ≤ bruto; **quantidade de item do PL deve ser inteira** (decimal = preço lido como quantidade).                                                              |
| **Conhecimento**                | `knowledge.ts`       | Valida NCM/porto/fornecedor contra a Base de Conhecimento. Tolerante: se a KB faltar, não gera alarme.                                                                                                         |

**Gate de confiança:** achado de **erro** (grounding/CNPJ/NCM mal-formado) →
confiança é limitada abaixo de 0.4, acionando o caminho de **revisão humana** já
existente no pipeline de documentos. Achados de **warning** só reduzem a confiança.

## 4. Base de Conhecimento

`apps/api/src/modules/ai/knowledge/*.json`, extraída da planilha Follow Up (fonte da verdade):

| Arquivo          | Conteúdo                                                           |
| ---------------- | ------------------------------------------------------------------ |
| `ncms.json`      | 360 NCMs válidos do importador                                     |
| `ports.json`     | portos de embarque/destino/transbordo                              |
| `parties.json`   | importadores + 559 fornecedores                                    |
| `carriers.json`  | armadores, agentes, canais, terminais                              |
| `premissas.json` | tarifas, transit time, CBM por container                           |
| `ean.json`       | base EAN Puket (a aba Espelho IMG está quebrada na origem `#REF!`) |

> **Operação:** os JSONs são copiados para `dist/` no `build` (`apps/api/package.json`)
> e seguem para o container via `COPY dist`. Sem isso, o harness perderia a KB em produção.
> Para complementar (EAN Imaginarium, CNPJs dos importadores, Siscomex), basta editar os JSONs.

## 5. Variáveis de ambiente (resumo)

```
AI_PROVIDER=vertex
GOOGLE_VERTEX_PROJECT=n8n-grupo-unico
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_VERTEX_CLIENT_EMAIL=gemini-n8n@n8n-grupo-unico.iam.gserviceaccount.com
GOOGLE_VERTEX_PRIVATE_KEY="..."        # SA dedicada (role roles/aiplatform.user)
AI_MONTHLY_BUDGET_USD=26               # ≈ R$150/mês
GOOGLE_DRIVE_PRE_CONS_FOLDER_ID=       # pasta do Drive com a planilha Pre-Cons
ESPELHO_AI_FALLBACK=0                  # 1 só com Vertex (espelho carrega dados sensíveis)
```

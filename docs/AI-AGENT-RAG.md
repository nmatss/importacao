# IA como Agente + RAG — Arquitetura e Guardas de Custo

Última atualização: 2026-06-22. Provider em prod: **Vertex AI** (Gemini 2.5 flash→pro).

O sistema usa IA em **dois caminhos**, ambos com RAG e ambos com teto de custo.

## 1. DocIntel — extração de documentos (harness + skills + RAG)
- Entrada: Invoice / Packing List / BL / Proforma / Espelho.
- Pipeline: parser determinístico → (fallback) LLM com **structured output** (schema Zod) →
  `fill*NullsFromText` (backfill determinístico de header) → harness de skills.
- RAG: `ai/rag/retriever.ts` injeta contexto de domínio da base `ai/knowledge/*.json`
  (NCMs, portos, fornecedores, carriers, premissas) como bloco **"reference only,
  never a license to invent"**, com snippets **sanitizados** (anti prompt-injection).

## 2. Assistente Operacional — agente RAG (`POST /api/assistant/query`)
Plugado na IA interna do sistema (balão flutuante em Importação/Certificações).
- **Retrieval híbrido, grounded:**
  - Dados estruturados do banco (processos, alertas, documentos, validações, e-mails)
    com `MAX_RECENT_ROWS` por fonte.
  - Base de conhecimento via `retrieveContext` (lexical sobre `ai/knowledge`).
  - Ranking por boost de fonte + match de tokens + match de código de processo;
    só entram fontes com `score > 0` (top-N configurável, default 10).
- **Geração grounded:** `generateOperationalAssistantAnswer` monta o prompt com as
  fontes e instrui o modelo a **usar SOMENTE as fontes, não inventar** dados/datas/
  valores/responsáveis, e dizer o que falta conferir. Fallback determinístico quando
  não há fonte (não chama o LLM à toa).
- **Citações:** a resposta retorna `sources[]` (título, trecho, url interna).

### Por que RAG lexical (e não pgvector) na KB de catálogos
Decisão deliberada (`retriever.ts:2`): para NCM/porto/fornecedor exato, match lexical é
mais **preciso** que similaridade semântica e tem **zero dependência de rede/custo**.
Upgrade semântico (bge-m3 **local/grátis**) fica reservado para texto livre (`premissas`)
— ver "Roadmap".

## 3. Guardas de custo (não estourar R$100/dia)
Toda chamada ao LLM passa por `this.chat()` → `assertBudgetAvailable()` + `logUsage()`
(`ai/cost-tracker.ts`). Camadas:

| Guarda | Onde | Default | Env |
|---|---|---|---|
| **Teto DIÁRIO** | `assertBudgetAvailable` (date_trunc dia, BRT) | **R$100/dia** | `AI_DAILY_BUDGET_BRL=100` (0 desativa) |
| Teto MENSAL | idem (mês BRT) | R$1.000/mês | `AI_MONTHLY_BUDGET_USD=200` |
| Conversão R$↔USD | — | 5 | `AI_BRL_PER_USD=5` |
| **Cap POR pergunta** | `generateOperationalAssistantAnswer` → `maxOutputTokens` | **768 tokens** | `ASSISTANT_MAX_OUTPUT_TOKENS=768` |
| Rate limit | `assistant/routes.ts` | 20 req/min | — |
| Aviso 80% | `assertBudgetAvailable` | alerta | — |

- Ao atingir o teto, o LLM é recusado (`AIBudgetExceededError` 429) e o assistente cai no
  **fallback determinístico** (sem custo) em vez de quebrar.
- **IA local é grátis** (custo 0 no pricing) — os tetos só "mordem" providers pagos
  (Vertex/OpenRouter). Boa prática de custo: **embeddings/retrieval local grátis +
  geração paga só no passo final**.
- `maxOutputTokens` mapeia para: Vertex `generationConfig.maxOutputTokens`, OpenRouter
  `max_tokens`, IA_LOCAL `num_predict`.

Acompanhamento: `GET /api/ai/usage` (gasto diário/mensal por modelo).

## 4. Melhores práticas já aplicadas
- Grounding estrito + instrução anti-alucinação + citações de fonte.
- Sanitização de snippets da KB (anti prompt-injection).
- Fallback determinístico (resiliência + custo).
- Structured output (schema) na extração.
- Custo observável (`ai_usage_log`) + tetos diário/mensal/por-pergunta + rate limit.
- Least-privilege de credencial (Vertex deve usar SA dedicada — ver `[[importacao-ai-vertex]]`).

## 5. Roadmap (próximos passos de RAG)
- Retrieval **semântico** (bge-m3 local, grátis) para texto livre (`premissas`/docs),
  mantendo o lexical para catálogos — híbrido.
- **Cache de respostas** para perguntas repetidas (economia de custo).
- Rate limit **por usuário** (hoje por IP/janela).
- Reranking + dedup de fontes; métricas de qualidade (taxa de fallback, citações usadas).

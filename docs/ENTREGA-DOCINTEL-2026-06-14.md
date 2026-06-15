# Entrega DocIntel — IA especialista de documentos (Grupo Uni.co)

**Data:** 2026-06-14 · **Branch:** `chore/auditoria-rodada-2` · **PR:** #73
**Autor:** Nicolas + Claude (Opus 4.8) · **Doc de arquitetura:** [`IA-ESPECIALISTA.md`](./IA-ESPECIALISTA.md)

---

## 1. Sumário executivo

Construímos o **DocIntel**: um sistema de IA **especialista** (não generalista) para
ler e analisar os documentos de importação (Invoice, Proforma, Packing List, BL
draft/final, espelho/Pre-Cons, certificado, Licença de Importação). A inteligência
vem de uma **arquitetura em camadas** (constituição + skills + RAG + harness de
confiança + defesa anti-injeção), não do tamanho do modelo — o que permite usar um
modelo pequeno/local mantendo qualidade de auditoria.

**Estado:** o sistema está **construído, testado (460 testes) e commitado**, e roda
em **qualquer provider** (é provider-agnóstico). A tese de **privacidade on-prem**
(modelo local) bateu num **limite de hardware** — ver veredito abaixo.

## 2. Veredito de produção (medido, não estimado)

| Meta                                                              | Estado                                  |
| ----------------------------------------------------------------- | --------------------------------------- |
| Sistema especialista (8 skills + RAG + harness + anti-injeção)    | ✅ completo, commitado, testado         |
| Rodar no **provider rápido** (gemini/OpenRouter/Vertex)           | ✅ pronto — basta `AI_USE_SPECIALIST=1` |
| **LLM local on-prem** (`unico-docintel` / qwen3-vl) para extração | ❌ **inviável no hardware atual**       |

**Por quê:** o `unico-docintel` (qwen3-vl:4b) foi construído e medido em produção no
Xeon E5-2650 (AVX1, **sem GPU**): **0,18 tokens/segundo** → **30–60+ min/documento**,
100% de CPU, load do servidor a 29. Inviável mesmo de forma assíncrona. **O gargalo é
hardware: para extração local em tempo aceitável é preciso GPU** (a RTX 4060 Ti do box
de dev já resolveria). O Modelfile já foi otimizado (`/no_think`) para o dia da GPU.

> A plataforma IA_LOCAL (Ollama + gateway bearer) **está no ar** e serve o Portal de
> Franquia (qwen3:4b chat + bge-m3). O DocIntel é um consumidor diferente; o que falta
> para ele é **GPU** (extração local) ou usar o **provider rápido** (já pronto).

## 3. Arquitetura em camadas

```
documento → 4. HARNESS (confiança)  grounding · formato · numérico · KB → dados confiáveis
 (imagem/   3. RAG (retriever)      injeta conhecimento de domínio do KB    + score + trust
  texto)    2. SKILL                prompt especialista + few-shot por tipo
            1. CONSTITUIÇÃO         regra de ouro anti-alucinação + anti-injeção
            0. MODELO               provider rápido (hoje) | unico-docintel (GPU-day)
```

- **Camada 0 — Modelo:** abstração `AIProvider` (openrouter | vertex | ialocal). Local
  é custo 0; seleção por `AI_PROVIDER`.
- **Camada 1 — Constituição** (`ai/skills/constitution.ts`): identidade especialista +
  regra de ouro + defesa anti prompt-injection, no nível da app (defesa em profundidade,
  vale em qualquer provider).
- **Camada 2 — Skill** (`ai/skills/`): unidade de especialização. Cada skill embrulha
  `schema` + `domainRules` + `fewShot` gold + `retrieval` + `verification`.
  `assemble.ts` monta a mensagem segura (constituição + RAG + few-shot + **documento
  cercado em delimitadores não-forjáveis**).
- **Camada 3 — RAG** (`ai/rag/retriever.ts`): retrieval lexical in-memory sobre o KB,
  snippets sanitizados (anti-injeção pelo próprio KB). `embeddings.ts` (bge-m3) é a
  fundação semântica futura. **pgvector foi rebaixado** a otimização condicional (KB é
  pequeno).
- **Camada 4 — Harness** (`ai/harness/`): grounding, formato (NCM/ISO6346/CNPJ/USD),
  consistência numérica, refutação por KB, score de confiança. Roda nos 8 tipos.

## 4. As 8 skills

`invoice` · `proforma_invoice` · `packing_list` · `ohbl` · `draft_bl` · `espelho` ·
`certificate` · `li` (Licença de Importação). Cada uma com `domainRules` campo-a-campo,
few-shot gold **validado contra o schema E contra o próprio harness** (zero erro), e
verificação. Adicionar uma skill = ensinar o modelo um novo documento (receita em
`IA-ESPECIALISTA.md`). Cross-checks do ambiente: `cbmVsContainerCheck` (CBM × tipo de
container, via `premissas.json`, só no `ohbl`) e `carrierKnownCheck` (armador ×
`carriers.json`, no `espelho`).

> ⚠️ **`li` é uma skill LATENTE:** está completa, validada e testada no registry, mas
> **ainda não é alcançada em runtime** — falta `extractLIData` no `ai/service.ts` e o
> roteamento em `documents/service.ts` (hoje `type==='li'` é marcado como "não
> implementado"). As **outras 7** skills são alcançáveis pelo pipeline. Ativar a `li`
> = adicionar `extractLIData` (espelhando as demais, chave `'li'`) + o `case 'li'`.

## 5. Segurança

Modelo de ameaça central: **prompt-injection indireto** (fornecedor embute ordem no
documento). Defesas em profundidade:

1. Constituição (modelo + app): conteúdo do documento é **dado, nunca instrução**.
2. Documento cercado em delimitadores **não-forjáveis** (`neutralizeFences` colapsa `=`).
3. Saída **só-JSON**: sem ferramenta, sem ação, sem rede → injeção no máximo corrompe um
   campo, que o harness pega.
4. RAG: snippets do KB sanitizados.
5. Perímetro: IA_LOCAL on-prem, gateway bearer, admin do Ollama bloqueado, sem porta no
   host. `http://` interno é aceitável **só** sob single-host + rede isolada (documentado).
6. Log: `redact` no pino para `authorization`/`apiKey`/`IA_LOCAL_API_KEY`.

> ⚠️ **Importante:** a defesa anti-injeção _no prompt_ só fica ativa com
> `AI_USE_SPECIALIST=1`. Até lá, o caminho legado (`ai/prompts/*`) injeta o documento
> sem cerca — mitigado hoje pela robustez do gemini, mas **estrutural só após ligar a
> flag**. Ligar a flag é, portanto, também um ganho de segurança.

## 6. Entregáveis (commits, branch `chore/auditoria-rodada-2`)

| Commit                    | Conteúdo                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `10db4c1`                 | DocIntel base: provider `ialocal`, 7 skills, constituição, `assemble.ts`, RAG retriever, eval harness, embeddings                                                  |
| `e2142f9`                 | **Plug:** wiring do pipeline no `service.ts` atrás da flag `AI_USE_SPECIALIST` (chave certa por tipo); timeout por provider; redact; correção do viés Santos/China |
| `b4edcd5`                 | Skill `li` + cross-checks de ambiente (CBM×container, carrier)                                                                                                     |
| `2803f85`                 | Teste de validação LIVE (gated por chave)                                                                                                                          |
| `62a4502` (repo IA_LOCAL) | Modelfile `unico-docintel` com `/no_think` (pronto p/ GPU)                                                                                                         |

## 7. Verificação

Typecheck 0 · ESLint 0 · **460 testes verdes + 1 skipped** (validate-live). Auditoria
multi-agente (8 agentes) + correções aplicadas (CNPJ gold inválido, harness não-aplicado
em 3 tipos, delimitador forjável, sanitização do retriever, coerção do scorer, honestidade
de docs). Revisão final 1000% antes do push.

## 8. Runbook — como ativar (provider rápido)

> Ordem segura. **Nenhum passo abaixo foi executado em produção ainda.**

1. **Deploy do código:** a branch precisa estar em produção (o build atual é anterior ao
   DocIntel). Mergear `chore/auditoria-rodada-2` (PR #73) e deployar pela pipeline.
2. **Validar no provider rápido** (antes da flag), com uma chave válida:
   ```
   OPENROUTER_API_KEY=sk-or-... npx vitest run validate-live
   ```
   Prova ponta-a-ponta que o pipeline extrai certo + passa o harness.
3. **Ligar a flag:** `AI_USE_SPECIALIST=1` no `.env` de produção (mantendo
   OpenRouter/Vertex como provider). Rollback instantâneo (basta `=0`).
4. **Observar** os primeiros documentos (confidence, `_trust`, fields em revisão).

## 9. Decisões em aberto (humanas)

1. **GPU?** Único caminho para extração **local** on-prem em tempo aceitável. Sem ela, a
   extração roda no provider hospedado (privacidade reduzida, mas qualidade do pipeline
   especialista mantida).
2. **Provider de extração em prod hoje** está incerto: a `OPENROUTER_API_KEY` do servidor
   tem 39 caracteres (chave OpenRouter válida tem ~73) e `AI_PROVIDER` está vazio.
   **Verificar** se a extração em produção está funcionando / qual provider/chave usa.
3. **Deploy/merge do PR #73** (release grande) — decisão de processo.

## 10. Débito técnico catalogado (para o dia da GPU / próxima rodada)

- Migrar o disparo de extração para a fila **pg-boss** existente (worker `ai-extraction`)
  - estado `extracting` persistido + concorrência 1 (necessário p/ VLM local).
- Skill **email_analysis** (schema é _flat_, não `{value,confidence}` — exige tratamento
  próprio do harness antes de virar skill de 1ª classe).
- Dados reais do RAG: cadastrar **CNPJs reais** de UNI.CO/PUKET/IMB TEXTIL em
  `parties.json`; **re-extrair a base EAN** (Puket truncada em 2000/24827; Imaginarium 0%).
- `PROMPT_VERSIONS` por skill (hoje tudo `v1.0`) para rastrear A/B no `ai_usage_log`.
- TLS interno (`tls internal` no Caddy) **se/quando** a topologia deixar de ser single-host.

## 11. Status pós-deploy (2026-06-14) + 🔴 achado de privacidade

**DEPLOYADO.** PR #73 mergeado em `master` (`9e1999a`) e `deploy.sh` rodado: **health
verde, sem rollback, todos os containers healthy.** Prod (192.168.168.124) agora tem
rodada-2 + DocIntel. `AI_USE_SPECIALIST` **OFF** (pipeline dormante — comportamento de
extração inalterado); `GOOGLE_GROUP_ALLOWED` setado (login ok); `.env` preservado (a
geração via Vault falhou de forma não-bloqueante).

**🔴 Achado de privacidade (pré-existente — NÃO causado pelo deploy):** a extração de
produção **funciona, mas via Gemini DEVELOPER API**, não Vertex:

```
AI_PROVIDER          = (vazio → openrouter)
OPENROUTER_BASE_URL  = https://generativelanguage.googleapis.com/v1beta/openai
OPENROUTER_API_KEY   = AIzaSy…   (chave da Gemini Developer API)
```

Isto **contradiz a decisão de privacidade do projeto** (ver `IA-ESPECIALISTA.md` /
memória): documento sensível (Invoice, CNPJ, BL) **deve** ir via **Vertex AI**
(`aiplatform.googleapis.com`, garantia contratual de **não-treino**), **não** pela
Developer API (que **treina nos dados** no tier free). Hoje os documentos vão para a
Developer API. `ai_usage_log` está vazio (`count=0`) — extração talvez não exercitada
recentemente, ou `logUsage` não grava (investigar à parte). Relacionado à **issue #60**
(Vertex IAM).

### Próximos passos (decisões humanas, priorizadas)

1. **Privacidade (mais importante):** migrar a extração para **Vertex** (`AI_PROVIDER=vertex`
   - credenciais + liberar API/role no GCP — issue #60). Enquanto não, dado sensível segue
     na Developer API.
2. **Ligar o pipeline especialista** (`AI_USE_SPECIALIST=1` + restart api): ativa 8 skills +
   RAG + harness + **defesa anti-injeção** sobre o provider atual. Recomenda-se **validar
   antes** (`OPENROUTER_API_KEY=<gemini> OPENROUTER_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai npx vitest run validate-live`)
   e, idealmente, resolver a privacidade (1) primeiro.

# Revisão completa — Leitura/Análise de Documentos + UX/UI página a página (2026-07-17)

Auditoria de 5 frentes paralelas (pipeline de leitura, análise pós-extração, UX importação ×2, UX certificações + fundação) + mergulho dedicado no layout. Todos os achados têm evidência `arquivo:linha` verificada no código. Contexto: commit `2339490` (confiança honesta P0-P2) já aplicado, ainda não deployado.

---

## PARTE 1 — Pipeline de LEITURA de documentos (chegada → texto)

### P0

1. **Job `ai-extraction` sem retry + `extractText` fora do timeout → doc preso para sempre num crash.** pg-boss v10 default `retryLimit=0` (`shared/queue/index.ts:22`, `documents/service.ts:812`); o timeout de 180s só cobre a chamada de IA (`:1275`), não o pdf-parse/OCR (`:1231`). Crash do worker (OOM num PDF de 50MB) = documento `isProcessed=false` eterno, sem reprocesso automático. **Fix: `retryLimit≥2` + backoff + timeout global.**
2. **Classificação: `ohbl` é testado DEPOIS de invoice/PL** (`email-ingestion/classify-document.ts:72-101`) — BL com "CI"/"INV" no nome vira invoice (o misclass conhecido dos docs). O refinamento por conteúdo só roda quando `docType==='other'` (`processor.ts:1104`). **Fix: detectar sinais de BL primeiro + cruzar filename×conteúdo com alerta em conflito.**
3. **E-mail só aceita PDF/XLSX/XLS** (`processor.ts:34-38`) — foto/JPG de invoice ou `.docx` é descartado **sem alerta** (`:1052-1083`; se todos os anexos forem unsupported → `ignored` sem alerta `:1294`). Upload manual aceita imagem/Word (`upload.ts:11-33`) — inconsistência direta.
4. **PDF escaneado degrada em silêncio**: OCR é opt-in (`ocr.ts:24`, `DOCUMENT_OCR_ENABLED` off) e o gatilho é `text.length < 50` (`service.ts:2103`) — watermark/lixo de 51 chars evita OCR e multimodal, e manda lixo pra IA. OCR trunca em 20 páginas silenciosamente (`ocr.ts:70`). **Este é o mesmo furo do grounding do P0 anterior — ligar OCR por padrão resolve os dois.**

### P1

5. Base64 de arquivo inteiro em memória sem cap (`service.ts:2121`) + fallback in-process quando a fila falha (`:823,840`) fura o `batchSize=1` → risco OOM em rajada.
6. E-mail sem código de processo → anexos órfãos sem alerta (o ramo de alerta exige `processCode && !processId`, `processor.ts:740`).
7. `reprocess` bloqueado por 409 nos primeiros 30 min de um job morto (`service.ts:2315`, stale=30min) — sem recuperação manual na janela.
8. Upload manual sem dedup por conteúdo (`service.ts:846-871`) — mesma invoice 2× = 2 extrações pagas + projeção ambígua por `createdAt desc`.
9. Lease de 10 min (`service.ts:86`) < OCR potencial de 20 min (`ocr.ts:59,82`) → extração dupla concorrente.

### P2

10. LI armazenada sem extractor (`service.ts:1290-1325`) — gap funcional conhecido.
11. Tokens de 2 chars na classificação (`pi`, `ci`, `co`, `li`) seguem frágeis.
12. Falha da IA de e-mail engolida (`processor.ts:551-563` retorna null → regex-only sem alerta).
13. `.msg`/`.doc` caem em `buffer.toString('utf-8')` = binário ilegível pra IA (`service.ts:2153-2210`).
14. `XLSX.read` sem guard de tamanho (zip-bomb/OOM) (`service.ts:2134`, `processor.ts:349`).

## PARTE 2 — ANÁLISE pós-extração

### P0 (falsos verdes)

1. **Auto-espelho aparece como 4ª fonte "independente" a 99%** — é montado copiando os números da própria Invoice/PL (`utils/build-espelho.ts:73-89`), mas o comparativo o exibe como "Espelho / Excel 99%" (`service.ts:3303`, `DocumentComparison.tsx:979`) → a fatura confere consigo mesma e fica verde. O payload não carrega `generatedBy`. **Fix: propagar origem + rotular "derivado de INV/PL" + não reportar 0.99.**
2. **Fonte única = verde**: `computeRowStatus` retorna `match` com 1 valor (`service.ts:3505`) — BL Number, Incoterm, Frete, ETA, Container etc. ficam verdes "conforme entre os documentos" sem nada para comparar. **Fix: estado neutro "fonte única".**
3. **Conflitos da reconciliação são engolidos**: divergência campo × espelho confiável só incrementa contador (`reconcile-core.ts:213`), não rebaixa confiança, não vira alerta, não é persistida (`reconcile.ts:155-167` grava só boosted/filled). Espelho diz qty=900, invoice diz 600 → ninguém fica sabendo.

### P1

4. `getExtractionEvidence` retorna o run da RECONCILIAÇÃO (sem excerpt/página) em vez do da extração (`service.ts:1056`, `reconcile.ts:142`).
5. **Linhagem por campo nunca chega ao operador** — endpoints `/extraction-evidence`/`/extraction-history` existem (`routes.ts:26-37`) e `persistExtractionLineage` grava trecho+página por campo, mas **zero consumidores no front**. Trabalho morto que resolveria o "por que esse valor?".
6. Detector determinístico de anomalias (default `ialocal`) cobre 4 checagens; o prompt de IA promete ~10 (nomes exportador/consignee, pesos PL↔BL, datas, bidirecional) (`ai/service.ts:1656-1732` vs `prompts/anomaly.ts:89-106`). Consignee de outra empresa no BL = nenhuma anomalia.
7. **Tolerâncias de data divergem entre painéis**: Comparativo ETD 45/90 dias (`service.ts:3020`) vs Checklist `dates-match` 10/30 (`checks/dates-match.ts:145`) — mesmo dado, verde num painel e warning no outro.
8. Reconciliação re-projeta sem o gate 0.4 (`reconcile.ts:130-137` sem `shouldProjectAiData`) — invoice de 0.30 entra no agregado se a aritmética bater.

### P2

9. `parseFloat(String(v).replace(',','.'))` quebra com milhar `1.234,56` (`service.ts:3530`).
10. `selectTrustedEspelho` exclui `auto_deterministic` mas não `ai_fallback` (`reconcile-core.ts:337`).
11. Peso bruto/CBM "secondary" nunca fica vermelho no comparativo (`service.ts:3078`) — divergência real de carga vira warning.
12. `notifyParty`/`sealNumber`/`voyageNumber` extraídos e quase não consumidos.

## PARTE 3 — UX/UI página a página (resumo dos top findings)

### Importação

| Página               | Top problemas                                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Login**            | Erro sem `role="alert"`; loading sem timeout/retry; "contate o administrador" sem link (`LoginPage.tsx:123-174`)                                                                                                                                                                                                  |
| **Dashboard**        | Falha de sub-query vira empty state (indistinguível de "sem dados") (`DashboardPage.tsx:215-228`); tooltips hardcoded brancos no dark mode; `<tr role="link">` com foco duplicado; sem filtro de período                                                                                                          |
| **Lista Processos**  | **Filtros não persistem na URL** (`:35-42`); sem ordenação de coluna; paginação some quando 1 página (total de resultados junto)                                                                                                                                                                                  |
| **Detalhe Processo** | **13+ abas em scroll com `scrollbar-hide`** (sem pista de que há mais) (`ProcessDetailPage.tsx:51-71,454`); textarea "urgente" sempre vermelho gritando mesmo vazia (`ProcessHeader.tsx:255`); spinner vs skeleton inconsistente; `MIN_OPERATIONAL_CONFIDENCE` hardcoded em 4 arquivos                            |
| **Documentos**       | 7 ações icon-only escondidas atrás de hover (`DocumentList.tsx:553`); upload sem toast (resto usa toast); reclassificar reprocessa SEM confirmação; **badge de confiança não explica o porquê** — crítico agora que a fórmula nova derruba os números; limiares de cor divergem (0.5/0.6/0.8 conforme componente) |
| **Validação**        | Melhor fluxo do sistema (confirmação + justificativa); só hierarquizar os 4 CTAs do header                                                                                                                                                                                                                        |
| **Follow-up**        | Kanban 1680px sem alternativa vertical; 3 vocabulários para os mesmos 3 estados; status por heurística client-side (>7d) sem relação com SLA real                                                                                                                                                                 |
| **Sydle**            | **Linhas clicáveis mouse-only** (sem tabIndex/keydown) (`SydlePaymentsPage.tsx:1441`); 14+ filtros fora da URL; drawer sem Esc/focus-trap                                                                                                                                                                         |
| **Assistente**       | Sem envio por Enter; quick-prompt sobrescreve texto digitado; erro mantém resposta velha sem sinalizar                                                                                                                                                                                                            |
| **Configurações**    | **Toggle Ativo/Inativo quebrado (`active` vs `isActive`) — exibição E ação** (`SettingsPage.tsx:42,592,695`); SMTP sem campo de senha; dois caminhos de desativação                                                                                                                                               |
| **Ingestão e-mail**  | `handleTrigger`/`handleReprocess` sem catch e sem toast — falha 100% silenciosa (`EmailIngestionPage.tsx:164,176`)                                                                                                                                                                                                |
| **Alertas**          | `limit=100` sem paginação na lista — alertas 101+ invisíveis (`AlertsPage.tsx:104`)                                                                                                                                                                                                                               |
| **Comunicações**     | Envio de e-mail (irreversível) sem ConfirmDialog (`CommunicationsPage.tsx:274`); e-mail sem validação de formato                                                                                                                                                                                                  |

### Certificações

| Página                | Top problemas                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CertDashboard**     | **Deep-links "Ver todos" não filtram nada** — mandam `?status=EXPIRED` mas Produtos só lê `cert_status/site_status/license_status` (`CertDashboardPage.tsx:418,468` vs `CertProdutosPage.tsx:176-180`); sem estado de erro; tooltip PieChart branco no dark |
| **CertValidação**     | **Botão trava em "Validando…" para sempre se o SSE falhar** (`CertValidationProgress` não chama `onComplete` no error); resultado sem CTA para o relatório                                                                                                  |
| **CertProdutos**      | Só status persiste na URL (marca/busca/período não); **sort client-side na página de 25 parece global**; tabela `min-w-[1200px]` estoura em laptop; filtros AND de 3 eixos sem chips/explicação                                                             |
| **CertCadastro**      | Sem confirmação antes de gravar no Linx (sistema externo); `handleRetry` engole falha; banners inline vs sonner no resto                                                                                                                                    |
| **CertAgendamentos**  | `catch {}` vazio em delete/toggle (falha silenciosa); `pollRef` único vaza interval com 2 execuções simultâneas                                                                                                                                             |
| **CertConfigurações** | Tela chamada "Configurações" é 100% read-only — não configura nada                                                                                                                                                                                          |
| **Badge fantasma**    | "Vendido - Venda Bloqueada" do print da Eli: não existe no código/git/dist → build cacheado antigo OU `site_status_reason` dinâmico do Sheets (`CertProdutosPage.tsx:638-644`). Cache-bust no deploy + inspecionar valores da planilha                      |

### Fundação

- **Sem primitivos Button/Card**: tokens existem (`@theme` primary/sidebar/danger) mas o botão gradiente esmeralda está copiado dezenas de vezes; cards idem. Dois sistemas de badge (StatusBadge vs CertStatusBadge). Accent emerald hardcoded no cert vs token primary na importação.
- **Sessão expira sem aviso**: 401 → `window.location='/login'` seco nos DOIS clients (`api-client.ts:21-25`, `cert-api-client.ts:252-255`), perde formulário preenchido, sem toast "sessão expirada", sem refresh token (JWT 24h).
- **Feedback pós-ação irregular**: toast (Validação/Comunicações/Relatórios) vs banner inline (Cadastro) vs silêncio total (Alertas ack, Ingestão, Usuários, Agendamentos).
- **Acentuação PT-BR inconsistente** em massa ("Atencao", "Concluidos no Mes", "Status Certificacao") vs telas acentuadas — pede um dicionário de labels.
- `formatCurrency` default USD; datas do cert-api renderizadas cruas sem `formatDate`.

## PARTE 4 — LAYOUT (mergulho dedicado)

**Veredicto visual: o shell é bom.** Sidebar dark enterprise bem resolvida — gradiente `sidebar-900→950`, collapse 72/264px animado, logo com indicador online (ping), item ativo com `bg-primary-600/20` + dot, seções agrupadas com labels uppercase, user-mini card, drawer mobile com overlay+blur, skip-target `#main`. Não precisa de redesign.

**Os problemas são estruturais, não estéticos:**

1. **`ImportacaoLayout` (402 linhas) e `CertificacoesLayout` (305) são ~73% idênticos literalmente** (diff normalizado: só 193 linhas divergem de 707). Toda melhoria precisa ser feita 2× e já divergiram: Importação tem `getBreadcrumb()` + `getPageTitle()` (linhas 106-136), Certificações só `currentNav?.label`. **Fix: um `AppLayout` parametrizado (navSections, accent, healthCheck, breadcrumbResolver).**
2. **Breadcrumb em 3 estados**: componente compartilhado `Breadcrumbs.tsx` usado em 1 arquivo; inline no ImportacaoLayout; ausente no CertificacoesLayout → detalhe de produto/relatório mostra título genérico "Produtos".
3. **Collapse da sidebar não persiste** (useState puro) — reseta a cada refresh.
4. **Sem switcher de módulo** — importação↔certificações exige passar pelo Portal. Um dropdown no logo resolveria.
5. **Accent por módulo não tokenizado** — cert usa emerald hardcoded; deveria ser `--color-accent` por módulo no `AppLayout`.
6. Dentro das páginas: as 13+ abas do ProcessDetail com `scrollbar-hide` e a tabela cert `min-w-[1200px]` são os dois pontos onde o layout de página quebra em telas reais (laptop 1366px).

## Ordem de ataque sugerida

**Rodada 1 — dados confiáveis (P0 análise + leitura):**

1. Auto-espelho rotulado + fonte única neutra + conflitos visíveis (mata os falsos verdes)
2. Retry da fila + timeout global + OCR determinístico p/ escaneados (mata docs presos e o furo do grounding)
3. Classificação BL-antes-de-invoice + alertar anexo descartado/órfão

**Rodada 2 — UX crítico (bugs de fluxo):** 4. Toggle usuários (`isActive`), SSE de validação travado, falhas silenciosas (Ingestão/Agendamentos/Alertas ack), deep-links do CertDashboard, confirmação de envio de e-mail 5. Sessão: interceptor 401 único com toast + returnTo

**Rodada 3 — fundação:** 6. `AppLayout` único + primitivos Button/Card + dicionário cor→significado + limiares de confiança unificados + explicação do "porquê" do badge (essencial pós-2339490) 7. Filtros na URL (Processos, Sydle, CertProdutos completo), acentuação, breadcrumbs

---

_Gerado pela auditoria multi-agente de 2026-07-17 (5 exploradores + verificação manual de layout). Achados verificados por arquivo:linha; números de duplicação medidos por diff._

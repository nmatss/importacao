# Plano de Validação — Importação & Certificação

> Documento de QA/Produto. Base: features implementadas nas rodadas 1–5 (branch
> `fix/eduarda-enterprise`), verificadas no código. Usuária primária:
> **Eduarda** (operadora fiscal/importação).
> Data-base: 2026-06-19.

---

## 1. Objetivo

Validar, com a usuária de negócio, que as correções e melhorias entregues
resolvem de fato a dor relatada por Eduarda nos dois fluxos centrais do produto:

1. **Revisão de processo de importação** (extração, espelho, comparativo,
   logística, checklist, proformas, e-mail).
2. **Lista de certificação** (status determinístico de certificado, conformidade
   no site, licenciamento e filtros).

O critério de sucesso é a usuária conseguir confirmar, item a item, que cada
ponto da sua lista de feedback original está resolvido — usando o script de
`docs/USER_ACCEPTANCE_TEST.md`.

---

## 2. Escopo

### Em escopo (in)

- Fluxo de revisão de processo de importação ponta a ponta na UI web.
- Comparativo consolidado Invoice × Packing List × Sistema, incluindo
  reconciliação de itens (matched / unmatched bidirecional).
- Barra de status logístico e derivação automática de etapa por ETD/embarque.
- Cartão de informações do processo com Data Embarque / Frete / Container do BL.
- Banner de cobertura de extração ("leu X% — campos não lidos").
- Checklist documental com marcação "concluído por <nome>".
- Aba de Proformas (itens / FOB / download / empty-state).
- Envio de e-mail operacional com erro acionável e allow-list de destinatários.
- Lista de certificação: `cert_status`, `site_status` (+ motivo),
  `license_status`/prazo e filtros multi-eixo server-side.

### Fora de escopo (out)

- Qualidade absoluta do modelo de extração de IA (depende do provedor — ver §4).
  O plano valida o **comportamento da UI/back-end**, não a acurácia de um modelo
  específico.
- Escrita em sistemas externos (Linx) — gated por descoberta de schema (issue #62).
- Integração SydleOne (fora desta rodada de validação de Eduarda).
- Performance/carga, segurança e DR (cobertos por outros planos).
- Reconciliação do journal de migrações Drizzle (tech debt não bloqueante).

---

## 3. Fluxos centrais a validar

### Fluxo A — Revisão de processo de importação

Abrir um processo → revisar espelho e cartão de informações → conferir
comparativo consolidado → validar checklist → revisar proformas → disparar
e-mail operacional. Verificado no código:

- `apps/web/src/features/processes/components/LogisticStatusBar.tsx` (etapa
  "Em Trânsito" derivada quando há embarque ou ETD no passado).
- `apps/web/src/features/processes/components/ProcessInfoCard.tsx` +
  `apps/api/src/modules/documents/utils/build-espelho.ts` (Data Embarque / Frete
  / Container projetados do BL).
- `apps/web/src/features/documents/DocumentComparison.tsx` (coluna "Sistema",
  linhas cross-document, tooltip de aceite, peso líquido + bruto por item,
  unmatched bidirecional).
- `apps/web/src/features/documents/AiExtractionSummary.tsx` (banner de cobertura).
- `apps/web/src/features/processes/components/DocumentChecklistTab.tsx`
  ("Concluído por <nome>").
- `apps/web/src/features/processes/components/ProformasTab.tsx` (itens/FOB/
  download/empty-state).
- `apps/api/src/modules/communications/service.ts` (allow-list + erro acionável).
- `apps/api/src/modules/validation/checks/invoice-pl-date-tolerance.ts`
  (tolerância de data INV × PL, 30 dias).

### Fluxo B — Lista de certificação

Abrir lista de certificação → aplicar filtros multi-eixo → conferir status
derivados de produtos conhecidos. Verificado no código (serviço
`apps/cert-api/`):

- `apps/cert-api/app/services/derivation.py` — `cert_status ∈ {ATIVO, ENCERRADO}`;
  `site_status ∈ {CONFORME, NAO_CONFORME}` com motivo obrigatório quando
  NAO_CONFORME; `license_status ∈ {VALIDO, VENCIDO, NAO_APLICAVEL}`.
- `apps/cert-api/app/services/erp_service.py` — leitura da aba
  "Licenciamentos Vencidos".
- `apps/cert-api/app/routes/certifications.py` — filtros server-side multi-eixo
  (`cert_status`, `site_status`, `license_status` + `search`/`brand`/datas),
  com paginação aplicada **após** os filtros derivados.

---

## 4. PRÉ-REQUISITOS (bloqueadores externos)

> **IMPORTANTE — VEREDITO STAGING-ONLY.** Os três pré-requisitos abaixo são
> bloqueadores de negócio/infra que NÃO estão sob controle do código. Enquanto
> não forem resolvidos, qualquer resultado da validação vale **apenas em
> staging** e **não pode** ser tratado como aceite de produção. Cada um tem um
> dono humano. Fonte: `docs/KNOWN_ISSUES.md` (seção "Bloqueadores de negócio").

| # | Pré-requisito | Por quê | Como satisfazer | Dono | Ref |
|---|---------------|---------|-----------------|------|-----|
| P1 | **Provedor de extração validado com documentos reais** (issue #60) | A extração de cabeçalho/portos/datas e os campos de cruzamento dependem do provedor de IA. No modelo local sem GPU os campos de cruzamento podem vir nulos/fracos. | Rodar os documentos reais de demonstração da Eduarda. **Se a qualidade do modelo local for insuficiente, trocar para Vertex** — o que exige liberar o bloqueio IAM (403) para `AI_PROVIDER=vertex` (`AI_ALLOW_EXTERNAL=true` + credenciais). | TI/Cloud (Nicolas) | `apps/api/src/modules/ai/service.ts`, `apps/api/src/shared/config/env.ts`, `docs/STATUS-2026-06-16.md` |
| P2 | **Destinatários operacionais de e-mail cadastrados** (issue #78) | `communicationService.send` bloqueia o envio quando o destinatário está vazio. Sem KIOM/FENICIA/ISA cadastrados, o teste de e-mail não pode passar. | Cadastrar **KIOM**, **FENICIA** e **ISA** em *Configurações > Destinatários operacionais* (ou via env `KIOM_EMAIL`/`FENICIA_EMAIL`/`ISA_EMAIL`), e garantir que estejam na allow-list. | Negócio/Operação | `apps/api/src/modules/settings/operational-recipients.ts`, `apps/api/src/modules/communications/service.ts` |
| P3 | **Estrutura real da planilha "Licenciamentos Vencidos" confirmada** (issue #87) | `license_status`/prazo do cert-api dependem das colunas/chaves reais da aba casarem com `cert_products` (SKU/Processo, Status, Validade). Se as chaves não casarem, o status de licença sai errado. | Validar com o negócio (Certificação) as colunas reais da aba e confirmar que o `license_map` casa por SKU/Processo com os produtos. | Negócio (Certificação) | `apps/cert-api/app/services/erp_service.py` |

Até P1, P2 e P3 serem resolvidos, **o veredito desta validação é staging-only.**

---

## 5. Ambiente de teste

- **Ambiente:** staging (não produção), com cert-api e api conectados às fontes
  de teste.
- **Build:** branch `fix/eduarda-enterprise` (rodadas 1–5).
- **Provedor de IA:** registrar qual provedor está ativo na execução
  (`ialocal` ou `vertex`). O veredito deve dizer explicitamente qual foi usado.
- **E-mail:** SMTP de staging + allow-list configurada (não enviar a destinatários
  reais sem cadastro/allow-list).
- **Navegador:** navegador suportado pela operação (desktop).

Registrar no campo de assinatura: URL do ambiente, build/commit, provedor de IA,
data e responsável técnico que preparou o ambiente.

---

## 6. Dados de teste necessários

1. **Documentos reais de demonstração da Eduarda** (Invoice, Packing List, BL,
   Proforma) — os mesmos que motivaram o feedback original. Essenciais para P1.
2. Pelo menos **1 processo com BL** contendo Data de Embarque, ETD/ETA, Frete e
   Container, para validar o cartão de informações e a barra logística.
3. Pelo menos **1 processo com ETD no passado** (para validar "Em Trânsito"
   automático) e **1 com ETD no futuro** (controle).
4. **1 processo cujo espelho não tenha itens** (para o teste de não-crash).
5. **1 proforma com itens** e **1 cenário sem proforma** (empty-state).
6. Par Invoice × Packing List com **divergência de itens** (para reconciliação
   matched/unmatched bidirecional) e com **datas divergentes além de 30 dias**
   (para o check de tolerância).
7. **Certificados conhecidos** PI4257Y e PI5101Y (devem resultar em
   `cert_status = ENCERRADO`), mais ao menos 1 produto ATIVO/CONFORME de controle.
8. Aba "Licenciamentos Vencidos" de teste com um SKU VÁLIDO e um VENCIDO.

---

## 7. Papéis

| Papel | Responsabilidade |
|-------|------------------|
| Usuária de validação (Eduarda) | Executa o UAT, marca pass/fail, registra observações. |
| Engenheiro de QA/Produto | Prepara dados, acompanha execução, classifica severidade, consolida resultados. |
| Responsável técnico (Nicolas/TI) | Prepara staging, define provedor de IA, resolve P1; apoia em falhas técnicas. |
| Dono de negócio (Operação / Certificação) | Resolve P2 (destinatários) e P3 (planilha); valida regras de negócio. |

---

## 8. Critérios de entrada (entry)

- Ambiente de staging no build correto e acessível à usuária.
- Dados de teste do §6 carregados.
- P2 e P3 idealmente resolvidos antes do início; P1 com provedor definido e
  documentos reais carregados.
- Script `docs/USER_ACCEPTANCE_TEST.md` disponível para a usuária.

## 9. Critérios de saída (exit)

- Todos os casos do UAT executados e marcados pass/fail.
- Nenhum defeito **Crítico** ou **Alto** aberto sem mitigação acordada.
- Pré-requisitos P1/P2/P3 resolvidos OU o veredito registrado explicitamente
  como **staging-only** com plano para reexecução pós-resolução.
- Seção de sign-off (§12) assinada.

---

## 10. Definições de severidade

| Severidade | Definição | Exemplo |
|------------|-----------|---------|
| **Crítica** | Bloqueia o fluxo central; perda/corrupção de dados; crash. | Espelho ou comparativo quebra a tela; e-mail vai para destinatário não autorizado. |
| **Alta** | Funcionalidade-chave incorreta sem workaround prático. | `cert_status` mostra valor fora de {Ativo, Encerrado}; cobertura de extração ausente em documento com campos faltando. |
| **Média** | Funcionalidade incorreta com workaround, ou erro de regra menor. | Tooltip de aceite não aparece; filtro multi-eixo retorna total errado. |
| **Baixa** | Cosmético, texto, layout sem impacto operacional. | Rótulo/format de data inconsistente. |

---

## 11. Registro de riscos

| ID | Risco | Prob. | Impacto | Mitigação |
|----|-------|-------|---------|-----------|
| R1 | Modelo local de IA produz campos de cruzamento nulos/fracos nos documentos reais. | Alta | Alto | P1: validar com docs reais; trocar para Vertex (#60) se insuficiente. Veredito staging-only até lá. |
| R2 | E-mail não pode ser testado por falta de destinatários cadastrados. | Média | Alto | P2: cadastrar KIOM/FENICIA/ISA antes do UAT (#78). |
| R3 | `license_status`/prazo errado por chaves da planilha não casarem. | Média | Alto | P3: confirmar colunas/chaves reais com Certificação (#87). |
| R4 | Resultado de staging interpretado como aceite de produção. | Média | Alto | Veredito explicitamente staging-only enquanto P1–P3 abertos. |
| R5 | Dados de teste não representam os casos reais da Eduarda. | Média | Médio | Usar exatamente os documentos/certificados de demonstração dela. |

---

## 12. Sign-off

| Campo | Valor |
|-------|-------|
| Ambiente / URL | __________________________ |
| Build / commit | __________________________ |
| Provedor de IA usado (ialocal / vertex) | __________________________ |
| P1 (extração/#60) resolvido? | ( ) Sim ( ) Não |
| P2 (destinatários/#78) resolvido? | ( ) Sim ( ) Não |
| P3 (planilha/#87) resolvido? | ( ) Sim ( ) Não |
| Veredito | ( ) Aprovado para produção ( ) Aprovado staging-only ( ) Reprovado |
| Defeitos abertos (Crítico/Alto) | __________________________ |

| Papel | Nome | Assinatura | Data |
|-------|------|-----------|------|
| Usuária de validação | Eduarda | ____________ | ______ |
| QA/Produto | | ____________ | ______ |
| Responsável técnico | Nicolas | ____________ | ______ |
| Dono de negócio | | ____________ | ______ |

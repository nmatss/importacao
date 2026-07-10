# Plano Mestre de Evolução — 2026-07-10

## Norte

Levar o portal a uma operação confiável, auditável e rápida para o pico de
documentos, sem automatizar sobrescrita de dados ou envio externo sem regra de
negócio explícita.

## Concluído nesta execução

| Frente       | Entrega                                                                             | Critério de aceite                                                                      |
| ------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Documentos   | Reclassificação auditável, reprocessamento por analista e linhagem direta de anexos | O operador recupera tipo incorreto sem reupload e mantém histórico.                     |
| Documentos   | Lease atômica, OCR local opt-in e evidência de campo                                | Trabalho duplicado não chama IA; OCR é limitado/observável; campo pode expor evidência. |
| Qualidade IA | Corpus sintético versionado e avaliador                                             | Regressões de parser/contrato podem ser medidas sem dados reais.                        |
| UX           | ErrorState/retry em páginas e queries críticas                                      | Falha de API não se apresenta como “sem dados”.                                         |

## P0 — Publicação e validação operacional

1. Aplicar migration `0024_document_analysis_hardening.sql` antes do novo
   código e confirmar as colunas de lease/evidência.
2. Instalar Poppler, Tesseract e idiomas `por`/`eng` no runtime somente se o
   OCR local for aprovado; ativar `DOCUMENT_OCR_ENABLED=1` e medir p95/erros.
3. Corrigir a configuração de mailbox para `global@grupounico.com`, validar
   permissões da conta de serviço e executar smoke test controlado.
4. Reprocessar PK2052602TJ com cópias anonimizadas ou aprovação operacional;
   aceitar somente após conferir exportador, referência OHBL, caixas, pesos,
   CBM, frete e itens.
5. Executar full resync administrativo SYDLE após deploy para rederivar linhas
   históricas de pagamento.

## P1 — UX operacional (próxima entrega)

1. SYDLE responsiva: presets de colunas, seletor persistido, painel de detalhes
   e modo compacto; substituir a tabela de 5600px como interface primária.
2. Acessibilidade de modais: componente Dialog compartilhado com foco inicial,
   trap de foco, Escape, `aria-describedby` e restauração de foco. Priorizar
   Comparativo e Configurações.
3. Processo: tablist com setas/Home/End e roving tabindex; indicadores claros
   de rolagem em tabelas largas e cabeçalhos sticky.
4. Performance: carregar gráficos e abas pesadas do detalhe de processo sob
   demanda; meta é reduzir o bundle inicial de Processo.

## P1 — Dados e automações

1. Follow-Up: definir planilha-fonte, frequência e resolução de conflito;
   iniciar com sincronização somente de leitura/alerta antes de qualquer escrita
   automática.
2. Fabricantes/fornecedores: importar base mestre versionada, com match por
   alias e fila de revisão humana para ambiguidade.
3. DUIMP: ampliar aliases a partir de fixtures reais e registrar qual fonte
   prevaleceu em cada campo de registro.
4. Avaliação IA: adicionar corpus anonimizado por layout/fornecedor e executar
   o gate de acurácia/latência no CI antes de trocar modelo ou prompt.

## P2 — Plataforma e governança

1. Migrar JWT de localStorage para cookies HttpOnly + CSRF antes de exposição
   pública.
2. Definir SLOs de ingestão/extracão, alertas de fila parada, OCR indisponível,
   lease expirada e frescor de integrações.
3. Revisar índices e planos das consultas de comparativo/SYDLE e criar política
   de retenção para texto/evidência documental.

## Regras de execução

- Cada item P1/P2 passa por desenho de contrato, migration reversível quando
  aplicável, teste de regressão e validação UX com dados não produtivos.
- Nenhuma automação de planilha, e-mail, alteração de processo ou integração
  externa deve sobrescrever dado sem fonte, precedência e rollback definidos.
- Mudanças de produção dependem de deploy aprovado, backup e smoke test pós
  publicação.

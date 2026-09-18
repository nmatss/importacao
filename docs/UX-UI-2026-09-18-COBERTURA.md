# Cobertura da revisão UX/UI — 18/09/2026

Complemento de [STATUS da revisão](STATUS-2026-09-18-REVISAO-UX-UI.md).

Axe em 375 px/claro e 1440 px/escuro. A coluna de achados reúne regras por URL, sem duplicar temas. Ausência de achado não certifica toda a acessibilidade. Fixtures locais; não valida integrações reais.

| URL / aba                                  | Varreduras | Regras apontadas                                                |
| ------------------------------------------ | ---------: | --------------------------------------------------------------- |
| `/certificacoes`                           |          2 | color-contrast, svg-img-alt                                     |
| `/certificacoes/agendamentos`              |          2 | color-contrast, heading-order                                   |
| `/certificacoes/cadastro`                  |          2 | Nenhuma nesse estado                                            |
| `/certificacoes/configuracoes`             |          2 | color-contrast, heading-order                                   |
| `/certificacoes/marketplace`               |          2 | color-contrast                                                  |
| `/certificacoes/produtos`                  |          2 | Nenhuma nesse estado                                            |
| `/certificacoes/produtos/SKU-E2E`          |          2 | color-contrast                                                  |
| `/certificacoes/relatorios`                |          2 | color-contrast                                                  |
| `/certificacoes/relatorios/1`              |          2 | color-contrast                                                  |
| `/certificacoes/validacao`                 |          2 | heading-order                                                   |
| `/importacao/alertas`                      |          2 | color-contrast, heading-order                                   |
| `/importacao/assistente`                   |          2 | landmark-unique                                                 |
| `/importacao/auditoria`                    |          2 | heading-order                                                   |
| `/importacao/cambios`                      |          2 | Nenhuma nesse estado                                            |
| `/importacao/compras-pagamentos`           |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/comunicacoes`                 |          2 | color-contrast, heading-order                                   |
| `/importacao/configuracoes`                |          2 | heading-order                                                   |
| `/importacao/dashboard`                    |          2 | color-contrast, svg-img-alt                                     |
| `/importacao/desembaraco`                  |          2 | color-contrast                                                  |
| `/importacao/email-ingestion`              |          2 | color-contrast, heading-order                                   |
| `/importacao/executivo`                    |          2 | color-contrast, scrollable-region-focusable, svg-img-alt        |
| `/importacao/follow-up`                    |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/lis`                          |          2 | Nenhuma nesse estado                                            |
| `/importacao/meu-dia`                      |          2 | color-contrast                                                  |
| `/importacao/numerario`                    |          2 | Nenhuma nesse estado                                            |
| `/importacao/pre-cons`                     |          2 | color-contrast, heading-order                                   |
| `/importacao/processos`                    |          2 | Nenhuma nesse estado                                            |
| `/importacao/processos/1`                  |          2 | color-contrast                                                  |
| `/importacao/processos/1/editar`           |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=cambios`      |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/processos/1?tab=checklist`    |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=comparativo`  |          2 | color-contrast, empty-table-header, scrollable-region-focusable |
| `/importacao/processos/1?tab=comunicacoes` |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=documentos`   |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=draft_bl`     |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=emails`       |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=erros_custos` |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=espelho`      |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/processos/1?tab=followup`     |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=historico`    |          2 | color-contrast                                                  |
| `/importacao/processos/1?tab=pre_cons`     |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/processos/1?tab=proformas`    |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/processos/1?tab=registro`     |          2 | color-contrast, scrollable-region-focusable                     |
| `/importacao/processos/novo`               |          2 | color-contrast                                                  |
| `/login`                                   |          2 | color-contrast, page-has-heading-one                            |
| `/portal`                                  |          2 | color-contrast                                                  |

## Estados de indisponibilidade

503 foi injetado nas chamadas de dados de 29 páginas. Autenticação da fixture permaneceu disponível. Resultados completos em `output/playwright/ux-review-20260918/errors.json`.

| Página                            | Resultado observado                                                |
| --------------------------------- | ------------------------------------------------------------------ |
| `/certificacoes`                  | Erro anunciado com ação de recuperação                             |
| `/certificacoes/agendamentos`     | Erro anunciado com ação de recuperação                             |
| `/certificacoes/cadastro`         | Erro anunciado com ação de recuperação                             |
| `/certificacoes/configuracoes`    | Offline/Indisponível e ação Testar Conexão                         |
| `/certificacoes/marketplace`      | Erro anunciado com ação de recuperação                             |
| `/certificacoes/produtos`         | Erro anunciado com ação de recuperação                             |
| `/certificacoes/produtos/SKU-E2E` | Erro visível com Tentar novamente; anúncio acessível pode melhorar |
| `/certificacoes/relatorios`       | Erro anunciado com ação de recuperação                             |
| `/certificacoes/relatorios/1`     | Erro anunciado com ação de recuperação                             |
| `/certificacoes/validacao`        | Erro anunciado com ação de recuperação                             |
| `/importacao/alertas`             | Erro anunciado com ação de recuperação                             |
| `/importacao/assistente`          | Conferir conteúdo e semântica no JSON                              |
| `/importacao/auditoria`           | Erro anunciado com ação de recuperação                             |
| `/importacao/cambios`             | Falso vazio; UX-01                                                 |
| `/importacao/compras-pagamentos`  | Erro anunciado com ação de recuperação                             |
| `/importacao/comunicacoes`        | Erro anunciado com ação de recuperação                             |
| `/importacao/configuracoes`       | Erro anunciado com ação de recuperação                             |
| `/importacao/dashboard`           | Erro anunciado com ação de recuperação                             |
| `/importacao/desembaraco`         | Erro anunciado com ação de recuperação                             |
| `/importacao/email-ingestion`     | Erro anunciado com ação de recuperação                             |
| `/importacao/executivo`           | Erro anunciado com ação de recuperação                             |
| `/importacao/follow-up`           | Erro anunciado com ação de recuperação                             |
| `/importacao/lis`                 | Erro anunciado com ação de recuperação                             |
| `/importacao/meu-dia`             | Erro anunciado com ação de recuperação                             |
| `/importacao/numerario`           | Erro anunciado com ação de recuperação                             |
| `/importacao/pre-cons`            | Erro visível, orientação inadequada/retry ausente; UX-06           |
| `/importacao/processos`           | Erro anunciado com ação de recuperação                             |
| `/importacao/processos/1`         | Erro anunciado com ação de recuperação                             |
| `/importacao/processos/1/editar`  | Erro anunciado com ação de recuperação                             |

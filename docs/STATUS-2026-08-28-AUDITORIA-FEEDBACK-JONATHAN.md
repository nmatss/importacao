# Auditoria do feedback operacional e handoff ao Jonathan

Data: 2026-08-28
Escopo: feedback de Importação e Certificação registrado entre 18/06 e 17/08/2026
Base revisada: `master` em `5b1f363` antes das alterações desta sessão

## Objetivo identificado

Revisar o histórico contra código, testes, documentação, memória e evidências
operacionais; corrigir pendências de código comprovadas; separar entrega técnica,
dependência externa e validação humana; preparar uma comunicação profissional ao
Jonathan sem declarar uma acurácia que não foi medida.

## Critério de status

- **CONCLUÍDO:** implementação e regressão existem; quando há afirmação de produção,
  existe checkpoint produtivo anterior.
- **CORRIGIDO NESTA SESSÃO:** código e testes locais concluídos, ainda sem deploy.
- **PARCIAL:** o fluxo principal existe, mas falta requisito avançado, dado ou decisão.
- **EXTERNO:** depende de credencial, fonte, configuração, arquivo ou aceite da operação.
- **NÃO COMPROVADO:** não há fixture/ground truth suficiente para medir acurácia.

## Resultado executivo

O núcleo solicitado está implementado: comparativo consolidado e editável, origem
visual PDF/Excel/Sistema, aceites e comentários, pesos por item, proformas, Espelho,
Registro/DUIMP, Erros e Custos Extras, e-mails editáveis com anexos/modelos/cópia
operacional, status de Certificação/E-commerce/Licenciamento e relatório alinhado.

A auditoria encontrou uma pendência objetiva: o checklist do Draft BL, inclusive
`Draft Recebido`, ainda usava `localStorage`. Isso não compartilhava o aceite entre
usuários e não oferecia autoria auditável. Nesta sessão ele passou a usar a API e o
histórico append-only `process_events`, registrando usuário, data, validação e
reabertura. A alteração está validada localmente e **não foi implantada**.

Uma segunda revisão, motivada pelo pedido urgente da Eduarda de 17/08, encontrou
outro desvio: Follow Up e Drive existiam no código, mas os padrões e o Compose ainda
permitiam voltar silenciosamente ao e-mail, upload manual e regex/IA. O contrato foi
fechado nesta sessão: referências somente do Follow Up, documentos somente da pasta
do processo no Drive, bloqueio sem snapshot válido e procedência explícita por
documento. Também está validado localmente e **não foi implantado**.

Não é tecnicamente correto afirmar que a IA está com 100% de acurácia. O provider
Vertex está implementado e testado, e a execução produtiva de 26/08 registrou chamadas
Vertex reais. Porém, a fotografia final tinha 40 de 51 documentos abaixo de 90% de
confiança, 39 checks falhos e aceite humano necessário nos 117 processos. Confiança,
completude e acurácia contra ground truth são métricas diferentes.

## Inventário — Importação

| Solicitação agrupada                                                         | Status                                                           | Evidência e limite                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ETD vencida avançar ciclo; BL preencher embarque, frete e container          | CONCLUÍDO                                                        | Autoavanço logístico, reconciliação e regressões de frete/BL estão no código e nos checkpoints de 07/08 e 26/08.                                                                         |
| Comparativo consolidado com coluna Sistema, sem quadros repetidos            | CONCLUÍDO                                                        | `DocumentComparison` usa quadro geral e oculta checks gerais ruidosos; Invoice, PL, BL, Espelho e Sistema são colunas do contrato.                                                       |
| Identificar PDF versus Excel e editar/aceitar valores com autoria            | CONCLUÍDO no requisito operacional; PARCIAL na linhagem avançada | A UI exibe PDF/Excel/Sistema, e `comparison_field_overrides`/aceites registram edição e usuário. Ainda falta persistir `sourceDocumentId`, versão e timestamp por valor consolidado.     |
| Tooltip dos comentários e aceite dos pontos de atenção                       | CONCLUÍDO                                                        | Aceites com comentário e revisão humana existem no comparativo.                                                                                                                          |
| Pesos líquido/bruto e proporção por item                                     | CONCLUÍDO no contrato                                            | Comparativo por item contém os campos; qualidade de cada documento depende da extração e precisa de fixture/original.                                                                    |
| Packing List, exportador, caixas, peso e CBM em português/inglês             | PARCIAL / NÃO COMPROVADO                                         | Parsers, aliases e fallbacks existem; PK2052602TJ e PLs abaixo de 90% ainda exigem confronto contra os originais. Não há corpus rotulado que sustente 99%/100%.                          |
| Correspondência de itens sem coleção/cor como ruído                          | CONCLUÍDO no normalizador                                        | O normalizador remove ruído conhecido e há regressões; casos reais novos devem gerar fixtures anonimizadas.                                                                              |
| Fabricantes por item e aliases do rodapé da Invoice                          | PARCIAL                                                          | Quadro por item e comparação aliases × fornecedores do Espelho existem. A validação de endereço/dados completos depende de base mestre de fornecedores.                                  |
| NCM: quatro dígitos do OHBL final versus oito do Espelho                     | CONCLUÍDO                                                        | Check dedicado `ncm-bl-description`; Invoice e PL não são usados nessa regra.                                                                                                            |
| Datas Invoice/PL com tolerância                                              | CONCLUÍDO                                                        | Check dedicado de tolerância e regressões existentes.                                                                                                                                    |
| Proformas com download, FOB e itens                                          | CONCLUÍDO no fluxo atual                                         | Documentos classificados como Proforma são agregados. Proformas legadas classificadas como Invoice/Outro dependem de reclassificação operacional.                                        |
| Espelho sem erro de `map`, leitura XLSX e criação a partir dos documentos    | CONCLUÍDO no fluxo                                               | Parser XLSX, tela e geração existem. Espelhos PDF e arquivos-imagem continuam fora do caminho determinístico.                                                                            |
| Checklist geral com nome de quem marcou como feito                           | CONCLUÍDO                                                        | Persistência e autoria já existiam no checklist do processo.                                                                                                                             |
| Draft BL: aceite de recebimento, NCM e reprocessar                           | CORRIGIDO NESTA SESSÃO para o aceite                             | NCM/reprocessamento já existiam. O aceite agora é compartilhado e auditável no servidor, com cobertura API e React.                                                                      |
| Processo editável sem obrigar todos os campos                                | CONCLUÍDO                                                        | Schema de atualização é parcial; regressões e status de 09/07 registram o ajuste.                                                                                                        |
| Nota urgente fixa, etapas customizadas, Registro/DUIMP e Erros/Custos Extras | CONCLUÍDO                                                        | Abas, persistência e tipos operacionais existem, incluindo os cinco tipos de lavagem/reparo solicitados.                                                                                 |
| Assuntos automáticos `Rascunho DUIMP...` e `REGISTRO DUIMP...`               | PARCIAL                                                          | Modelos customizáveis existem; os dois templates automáticos não existem. O segundo depende da referência Fenícia, ainda não promovida ao contrato do processo/extrator.                 |
| Projeto n8n de conferências de fechamento                                    | NÃO AUDITÁVEL NESTE REPOSITÓRIO                                  | A conversa menciona o envio, mas o artefato/workflow não está versionado aqui. O quality check geral do n8n em 26/08 registrou 53 OK, 4 WARN e 0 FAIL, sem provar esse fluxo específico. |

## Inventário — E-mails e Atendimentos

| Solicitação agrupada                                                  | Status                                       | Evidência e limite                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Ler/editar rascunho, destino, assunto e corpo antes de enviar         | CONCLUÍDO                                    | Comunicações e aba do processo expõem editor e retomada de rascunho.                                                                       |
| Expandir e consultar corpo dos e-mails já registrados                 | CONCLUÍDO                                    | A aba E-mails possui expansão do conteúdo e anexos.                                                                                        |
| Pesquisar processo numa lista extensa                                 | CONCLUÍDO                                    | Seleção pesquisável implementada.                                                                                                          |
| Criar, editar, salvar e desativar modelos próprios                    | CONCLUÍDO                                    | Gerenciador de modelos existe; versionamento de versões antigas é dívida opcional.                                                         |
| Anexar do computador ou Drive, visualizar/baixar e salvar no processo | CONCLUÍDO no código; EXTERNO para Drive      | Upload local e associação funcionam; o folder raiz do Drive respondia 404 no último probe produtivo.                                       |
| `global@grupounico.com` sempre em cópia                               | CONCLUÍDO no código e release anterior       | Cópia obrigatória é aplicada no servidor e validada no transporte. Alterar/remover depende de configuração autorizada.                     |
| Destinatários operacionais/allowlist visíveis em Configurações        | CONCLUÍDO no produto; EXTERNO para cadastros | Tela e contrato existem. KIOM/Fenícia/ISA precisam estar cadastrados com os endereços aprovados em produção.                               |
| Envio SMTP real                                                       | CONCLUÍDO no último checkpoint               | Em 26/08 uma mensagem sanitizada foi aceita e localizada pelo Gmail. IMAP continua sem autenticação e não invalida o SMTP/Gmail principal. |

## Inventário — Certificação

| Solicitação agrupada                                                         | Status                               | Evidência e limite                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status Certificação somente Ativo/Encerrado                                  | CONCLUÍDO                            | Derivação e filtros foram reduzidos aos status acordados.                                                                                                                               |
| Status E-commerce somente Conforme/Não Conforme e respeito ao prazo de venda | CONCLUÍDO na regra                   | Casos PI4511Y/PI7550Y/PI7551Y/PI7553Y/PI7560Y e texto de reinclusão possuem correções documentadas. Novos desvios precisam de SKU e fonte atual.                                        |
| Status/Prazo de Licenciamento pela aba Licenciamentos Vencidos               | CONCLUÍDO                            | Mapeamento separado do status de certificação. Prazo só pode existir quando a fonte contém data válida.                                                                                 |
| Relatório refletir painel e adicionar status/tipo/número/prazo/venda/travas  | CONCLUÍDO no contrato                | Relatório compartilha derivação do painel; EAN não ocupa SKU e `Vencido` foi removido.                                                                                                  |
| Imaginarium/Puket usar V; Puket Escolares usar I; tipo escolar usar D        | CONCLUÍDO                            | Regressões e status de 17/08 confirmam o mapeamento D/E/H/I para escolares.                                                                                                             |
| PI7223Y e estoque painel/relatório/WMS                                       | CONCLUÍDO na regra; risco de frescor | Última verificação: 7 físicos, 7 reservados, 0 disponíveis e 28 no e-commerce. Painel usa disponível, não físico. Sync diário pode atrasar até 24h.                                     |
| Descrições e-commerce ausentes                                               | EXTERNO                              | Restam 14 SKUs sem descrição e 15 SKUs duplicados com textos conflitantes; corrigir a planilha/fonte fiscal.                                                                            |
| Travas de faturamento Certificação/Licenciamento                             | PARCIAL                              | As colunas existem e a integração Linx foi revisada; lacunas reais e governança de escrita precisam de decisão fiscal. Não inferir valores em massa.                                    |
| Cadastro de certificado para analistas                                       | CONCLUÍDO                            | A autorização/tela foi ajustada e os acessos da equipe foram retomados no histórico.                                                                                                    |
| Disponibilidade atual                                                        | PARCIALMENTE COMPROVADA              | API pública respondeu 200 nesta sessão. O gateway da Cert-API respondeu 401 sem sessão, como esperado pela política fail-closed; o último readiness autenticado documentado é de 26/08. |

## Integrações e operação ainda pendentes

- **ALTO — qualidade documental:** fontes originais e ground truth humano para os
  documentos de baixa confiança; não reprocessar cegamente PLs que já repetiram timeout.
- **ALTO — IMAP/Drive/Odoo:** IMAP sem autenticação, Drive raiz indisponível e Odoo
  bloqueado por DNS no último checkpoint.
- **ALTO — Linx:** substituir contas pessoais por contas de serviço com menor
  privilégio e rotação via SOPS.
- **MÉDIO — Follow-Up:** comparação e sincronização administrativas são manuais; não
  existe job automático, o Sheet ID da API principal está ausente e faltam política de
  frequência/sobrescrita.
- **MÉDIO — Certificação:** completar as 14 descrições ausentes, resolver 15 duplicatas
  conflitantes e definir SLA de frescor do estoque.
- **MÉDIO — DUIMP:** decidir se a referência Fenícia vira campo do processo e do
  extrator antes de automatizar os dois assuntos de e-mail.
- **MÉDIO — fornecedores:** fornecer base mestre se for necessária validação de dados
  completos além de itens e aliases.
- **MÉDIO — alertas:** Google Chat não teve publicação real nesta sessão.

## Correção implementada nesta sessão

### Checklist auditável do Draft BL

- Novas rotas autenticadas:
  - `GET /api/processes/:id/draft-bl-checklist`
  - `PATCH /api/processes/:id/draft-bl-checklist`
- Chaves aceitas são uma enumeração Zod fechada; campos arbitrários são rejeitados.
- Alterações respeitam o bloqueio do processo.
- Cada validação/reabertura gera evento append-only e audit log com usuário.
- A UI removeu `localStorage`, refaz a consulta após a alteração, mostra nome/data e
  não mascara erro de persistência.
- Nenhuma migration foi necessária: foi reutilizada a trilha `process_events`.

### Segurança da alteração

- **CRÍTICO:** nenhum achado novo.
- **ALTO:** nenhum achado novo no caminho alterado.
- As rotas estão atrás de `authMiddleware`, payload limitado por Zod e escrita
  bloqueada em processo travado.
- Não foram lidos, exibidos ou alterados secrets; não houve escrita em produção.
- Riscos sistêmicos remanescentes estão registrados em `docs/KNOWN_ISSUES.md` e
  `docs/SECURITY_AUDIT_2026-08-26.md`.

## Validações executadas

| Comando                                             | Resultado                                                |
| --------------------------------------------------- | -------------------------------------------------------- |
| `npm run format:check`                              | passou                                                   |
| `npm run lint`                                      | passou                                                   |
| `npm run typecheck`                                 | passou                                                   |
| `npm test -w apps/api`                              | 994 passaram, 1 ignorado                                 |
| `npm test -w apps/web`                              | 141 passaram                                             |
| `npm run build`                                     | API e web passaram; `ProcessDetailPage` 246,86 kB        |
| `npm audit --audit-level=high`                      | 0 vulnerabilidades                                       |
| `.venv/bin/python -m pytest -q` em `apps/cert-api`  | 523 passaram                                             |
| `.venv/bin/ruff check app tests` em `apps/cert-api` | passou                                                   |
| `npm run test:e2e:web`                              | Playwright 82/82, desktop e Pixel 7                      |
| `git diff --check`                                  | passou                                                   |
| smokes públicos read-only                           | `/api/health` 200; `/cert-api/api/health` sem sessão 401 |

Durante o primeiro gate completo, um teste assíncrono preexistente de detalhe de
certificação falhou por consultar o DOM antes da atualização do estado. O teste passou
isoladamente, foi estabilizado com `findByText` e a suíte web completa passou em seguida.

## Limites desta sessão

- Não houve deploy, push, migração, escrita remota, envio de e-mail, replay de
  documentos, sync de planilha/Linx nem publicação no Chat.
- O `.env` local seleciona IA local; os testes validam o contrato Vertex, não uma
  chamada paga ao Vertex nesta máquina. A evidência de Vertex real é o checkpoint
  produtivo de 26/08.
- O smoke sem autenticação não valida dados privados da Cert-API; ele confirma a
  disponibilidade do gateway e a negação de acesso anônimo.
- Homologação humana continua necessária para PK2052602TJ, documentos de baixa
  confiança, status fiscais e fontes externas.

## Complemento — contrato operacional Follow Up + Drive

### Fato observado

- `PROCESS_REFERENCE_SOURCE` já tinha default `follow_up`, mas
  `getReferenceSource()` retornava `legacy` quando o Sheet ID não estava
  configurado.
- `DOCUMENT_SOURCE` ainda tinha default `email`; valor desconhecido também
  voltava para e-mail.
- Os dois arquivos Compose não transmitiam ao contêiner as variáveis de Follow
  Up/Drive. Configurar o host não alterava o processo Node.
- A varredura do Drive percorria todos os processos do banco, inclusive códigos
  de item e referências legadas fora do Follow Up.
- Upload multipart continuava disponível e documentos do Drive não tinham
  procedência persistida; a interface podia rotulá-los como upload manual.
- O diagnóstico anterior de extração continua válido: campos `-` vêm de falha,
  documento sem campo ou baixa confiança. Acurácia não pode ser inferida de
  `isProcessed` nem do uso do Vertex.

### Decisão e implementação

- O sistema passa a falhar fechado sem Follow Up: não vincula, não cria e não
  importa documento. Cache do último snapshot válido continua permitido e é
  marcado como `stale`.
- `DOCUMENT_SOURCE=drive` é o padrão. E-mail, varredura histórica,
  reprocessamento de e-mail e upload multipart ficam bloqueados nesse modo.
- A UI consulta `GET /api/documents/source-policy` e orienta usar a pasta do
  processo em vez de exibir o dropzone.
- A varredura só processa códigos presentes no Follow Up por igualdade exata
  normalizada.
- Migration aditiva `0026` registra `ingestion_source`; registros legados não
  são retroativamente adivinhados.
- Arquivos do Drive passam pela mesma validação de assinatura real aplicada ao
  upload multipart; conteúdo renomeado é rejeitado antes de ser persistido ou
  enviado ao extrator.
- Compose dev/prod, `.env.example`, SOPS de exemplo, health administrativo,
  OpenAPI e smoke foram alinhados ao contrato.
- O harness E2E passou a descobrir automaticamente as migrations SQL 0011+;
  uma lista manual tinha omitido a `0026` no primeiro gate.

Contrato detalhado:
`docs/operations/document-intake-contract-2026-08-28.md`.

### Validação adicional

| Comando                                                 | Resultado                                                |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `npm run format:check`                                  | passou                                                   |
| `npm run lint`                                          | passou                                                   |
| `npm run typecheck`                                     | passou                                                   |
| `npm test -w apps/api`                                  | 1.002 passaram, 1 ignorado                               |
| `npm test -w apps/web`                                  | 143 passaram                                             |
| `npm run test:e2e -w apps/api`                          | 48 passaram com PostgreSQL 16/migrations reais           |
| `.venv/bin/python -m pytest -q`                         | 523 passaram                                             |
| `.venv/bin/ruff check app tests`                        | passou                                                   |
| `npm run build`                                         | API e web passaram                                       |
| `npm run test:e2e:web`                                  | 82/82, desktop e Pixel 7                                 |
| `npm audit --audit-level=high`                          | 0 vulnerabilidades                                       |
| `docker compose config --quiet`                         | passou                                                   |
| Compose de produção com valores sintéticos obrigatórios | passou; defaults renderizados como `follow_up` + `drive` |
| `node scripts/smoke-integrations.mjs`                   | confirmou política local; dependências externas ausentes |
| `git diff --check`                                      | passou                                                   |

Revisão de segurança do fluxo alterado: nenhum achado CRÍTICO ou ALTO novo. Foi
identificada e corrigida uma diferença de validação classificada como MÉDIA: a
varredura do Drive confiava na extensão/MIME enquanto o multipart já conferia
magic bytes. Os dois caminhos agora compartilham a política, com testes positivo
e negativo.

### Gate operacional atualizado no preflight de produção

- A planilha oficial do Follow Up foi localizada, cadastrada no SOPS e validada
  com a conta de serviço. A leitura passou a fixar a aba `Processos`, que contém
  os dois processos-piloto e 486 códigos com formato de processo; sem a aba
  explícita, a API selecionava uma aba auxiliar.
- A pasta operacional de 2026 foi localizada, mas a mesma conta de serviço
  recebe 404. O código foi adaptado ao layout real
  `<ano>/<Marca>/Importado/Processo Nº <código>`.
- O release mantém temporariamente `DOCUMENT_SOURCE=email` no SOPS para não
  interromper a operação. Drive-only só deve ser ativado depois que a pasta for
  compartilhada e `health/integrations` + smoke ficarem verdes.
- A rotina oficial de migration também foi corrigida para aplicar a `0026`;
  antes o script terminava em `0025`.

## Mensagem atualizada para Eduarda e time

> Oi, meninas! Dei prioridade aos três pontos para conseguirmos colocar a parte
> documental em uso com mais segurança durante o pico.
>
> Fizemos uma revisão completa do fluxo de leitura. O sistema agora diferencia
> claramente documento processado, cobertura, baixa confiança e falha; extração
> vazia não aparece mais como leitura concluída. Também ficaram cobertos os
> tratamentos de PDF pesquisável/escaneado, Excel, resposta inválida da IA,
> timeout e reprocessamento. Mesmo assim, a validação final dos campos precisa
> ser feita contra o documento original — não vou prometer 100% de acurácia sem
> essa conferência.
>
> Para as referências, o Follow Up passou a ser uma trava real: só uma
> referência completa existente na planilha pode ser usada. Código de item,
> referência incompleta ou processo fora da lista não é mais vinculado nem
> criado. Se a planilha estiver indisponível, o sistema para essa entrada e
> avisa, em vez de voltar silenciosamente ao comportamento antigo.
>
> Para os documentos, nesta fase a única entrada autorizada é a pasta do
> processo no Drive. A ingestão por e-mail, o reprocessamento histórico de
> e-mails e o upload manual ficam bloqueados; a tela orienta colocar o arquivo
> na pasta correta e registra que a origem foi o Drive.
>
> A correção passou por 1.002 testes de API, 143 testes web, 48 testes de
> integração com banco/migrations, 523 testes de Certificação e 82 cenários de
> navegador em desktop e celular, além de lint, typecheck e build.
>
> Para liberar esta versão, falta a etapa operacional: cadastrar no ambiente o ID da
> planilha Follow Up e o ID real da pasta raiz do Drive, compartilhar os dois
> com a conta de serviço, publicar a versão e homologar uma amostra real de
> Invoice + Packing List + BL. Até isso acontecer, o sistema fica bloqueado por
> segurança e não usa e-mail como fallback. Essa homologação também vai indicar
> quais campos eventualmente ainda exigem ajuste por layout de documento.

## Mensagem sugerida ao Jonathan

> Olá, Jonathan. Concluí uma revisão técnica e funcional do histórico de Importação e
> Certificação contra o código, testes e evidências operacionais.
>
> Os principais fluxos já estão implementados: comparativo consolidado e editável,
> fontes PDF/Excel/Sistema, pesos e conferência por item, e-mails com rascunho editável,
> modelos/anexos/cópia operacional, Registro e DUIMP, custos extras, além dos status e
> relatórios de Certificação/E-commerce/Licenciamento.
>
> A auditoria encontrou uma pendência real no Draft BL: os aceites ainda ficavam apenas
> no navegador. Corrigi isso agora; o checklist passou a ser compartilhado e auditável,
> registrando usuário, data, validação e reabertura no histórico do processo.
>
> Também corrigi o contrato urgente da entrada documental: o Follow Up agora é uma
> allow-list fail-closed de referências completas e, por padrão, somente a pasta do
> processo no Drive pode alimentar documentos. E-mail, histórico e multipart ficam
> bloqueados nesse modo; a origem é auditável e arquivos do Drive têm assinatura real
> validada antes da extração.
>
> O gate consolidado passou por typecheck, lint, build, 1.002 testes de API (+1
> ignorado), 143 testes web, 48 testes E2E da API com PostgreSQL e migrations reais,
> 523 testes da Cert-API e 82 cenários Playwright. Ainda não foi feito deploy.
>
> Permanecem pendências que não devem ser tratadas como falha concluída de código:
> documentos sem ground truth ou com baixa confiança, configuração do Follow Up/Drive/
> IMAP/Odoo, cadastro dos destinatários operacionais, 14 descrições fiscais ausentes e 15
> duplicidades na planilha de certificação, conta de serviço Linx, referência Fenícia
> para automatizar os assuntos DUIMP e eventual base mestre de fornecedores.
>
> O Vertex está implementado, testado e teve chamadas reais registradas no último
> checkpoint produtivo. Ainda assim, não vou declarar “100% de acurácia”: a validação
> final depende dos documentos originais e do aceite da operação.
>
> Próximo passo recomendado: configurar e compartilhar a planilha Follow Up e a pasta
> raiz do Drive, aplicar a migration e publicar em janela controlada; depois, homologar
> PK2052602TJ, um Packing List representativo, um processo com Proforma, um fluxo DUIMP
> e uma amostra dos SKUs de certificação.

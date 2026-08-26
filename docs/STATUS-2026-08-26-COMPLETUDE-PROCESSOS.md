# Status — Completude, Replay E Evidência Dos Processos

Data: 2026-08-26

Baseline: `e7d170805b07034da8acc8f4b059237b0d2d9a46`

## Objetivo

Executar os oito passos solicitados para explicar cobertura documental,
reclassificar `other`, reextrair baixa confiança, validar os 117 processos,
revisar falhas/avisos, reconciliar Linx/e-mail/certificados, decidir
`process_items` e gerar relatório campo a campo.

## Fatos Confirmados

- A planilha oficial Follow Up foi reconciliada com 117 códigos/ETDs.
- Apenas 12 processos possuem 51 documentos; os outros 105 não têm arquivo
  local no portal e, portanto, são `master_only`, não extrações falhas.
- Os 51 documentos estavam marcados processados; 41 tinham confiança abaixo de
  90% e 16 eram `other`.
- Dos 20 documentos sem run de extração, 16 eram `other`, três eram espelhos e
  um era legado/core. O código não registrava os caminhos skipped,
  deterministic ou failed.
- Somente 10 processos tinham validation run; todos continham falhas no último
  agregado. A regra de ETD antiga gerava falso negativo para processos
  históricos.
- `process_items` estava vazia, mas itens podem existir no JSON da
  Invoice/Packing List/espelho. A tabela é usada como projeção editável do
  fluxo de espelho, não como fonte original da extração.
- Número/tipo do certificado vêm da planilha; validade/licenciamento vêm do
  Linx nas propriedades Imaginarium `00106/00107` e Puket/Puket Escolares
  `00224/00225`.
- Gmail permite a cadeia Message-ID → attachment/hash → documento → processo;
  status de e-mail `completed` isolado não prova vínculo documental.

## Implementação Preparada

- Atualização terminal do documento e criação do extraction run agora são uma
  única transação para `completed`, `failed`, `skipped` e `deterministic`.
- Validação `partial` tornou-se endpoint público compatível e persiste os 29
  checks em histórico imutável, sem workflow, Drive, correção ou notificação.
- ETD com mais de 90 dias passou de falha de consistência para aviso de frescor.
- Lease normal subiu de 10 para 25 minutos.
- Replay pode usar `DOCUMENT_REPLAY_DEFER_DERIVED=1`; validação e reconciliação
  ficam para o fechamento do processo.
- Resume do replay só pula `terminal_completed`, não simples `enqueued`.
- `gmailQuery` foi incluído na redação de logs.
- Operadores adicionados:
  - `triage-other-documents`: leitura de nome/conteúdo, hash e sugestão sem
    persistir texto;
  - `backfill-document-terminal-lineage`: dry-run e run histórico append-only;
  - `audit-gmail-source-reconciliation`: Gmail allowlist por hash contra banco;
  - `audit-process-completeness.mjs`: validação parcial resumível e relatório
    seguro por processo/campo/check.
- Os dois operadores HTTP são copiados explicitamente para a imagem da API;
  logs JSONL ficam em `0600` e não contêm nomes de arquivos.
- ADR 0006 formalizou itens do documento como fonte canônica e
  `process_items` como projeção opcional.

## Validações Locais

- `npm run format:check`: passou.
- `npm run lint`: passou.
- `npm run typecheck`: passou.
- `npm test`: API 987 passaram + 1 skip; web 140 passaram.
- `npm run build`: API e web passaram.
- Build Docker da API passou; os operadores foram lidos e validados dentro da
  imagem final.
- Cert-API: 523 testes passaram; Ruff passou.
- `npm audit` completo e runtime: zero vulnerabilidades.
- `git diff --check`: passou.
- `docker compose ... config --quiet` passou usando apenas placeholders não
  secretos para as substituições obrigatórias; o runner oficial continuará
  gerando os valores reais via SOPS no servidor antes do deploy.
- Revisão segura dos operadores: token somente por ambiente, nenhuma gravação
  no Gmail durante auditoria, conteúdo/filename não persistidos e relatórios
  privados. Não foi criado novo achado crítico ou alto.

## Operação Remota Pendente

O host `192.168.168.124` passou a responder `No route to host` durante esta
etapa. Por segurança, não houve tentativa de contornar o runner nem uso de uma
rota alternativa não documentada.

Quando a rota voltar, a ordem obrigatória é:

1. confirmar revisão/saúde e refazer inventário agregado;
2. backup PostgreSQL + uploads e restore test;
3. implantar o código e subir override de replay;
4. executar triagem `other` e aplicar somente tipos inequívocos;
5. executar backfill terminal append-only;
6. piloto de um documento suportado abaixo de 90%;
7. expandir replay em concorrência 1 somente se o piloto reconciliar;
8. restaurar configuração normal e reconciliar uma vez;
9. validar os 117 em modo parcial e gerar o relatório privado;
10. executar reconciliações Gmail e Linx/certificados somente leitura;
11. fechar exceções, atualizar o release gate e executar deploy/smokes.

## Limites E Aprovação

- Reprocessamento não cria arquivos para os 105 processos `master_only`.
- Reexecução probabilística não prova que um campo está correto.
- Documentos de apoio legítimos devem permanecer `other` com justificativa, não
  receber tipo inventado.
- Lacunas fiscais de Puket Escolares e casos ambíguos exigem responsável de
  negócio.
- Nenhum relatório automático emitirá `approved=true`; a aprovação final é
  humana e deve ser registrada.

# Contrato operacional de referências e entrada de documentos

Data: 2026-08-28
Origem do requisito: Eduarda, 17/08/2026
Escopo: fase inicial de uso operacional da conferência documental

## Objetivo

Reduzir associações incorretas durante o pico de documentos. Nesta fase, a
planilha Follow Up é a autoridade sobre referências de processo e a pasta do
processo no Google Drive é a única autoridade de entrada de documentos.

Este contrato não afirma acurácia de extração de 100%. Ele controla **quais
processos e arquivos podem entrar** e preserva a revisão humana dos campos
extraídos.

## Regras de autoridade

1. `PROCESS_REFERENCE_SOURCE=follow_up` é o padrão.
2. Uma referência só é aceita quando existe na coluna A da aba explícita
   `Processos` do Follow Up após normalização exata: maiúsculas e remoção de
   espaços, `-`, `_`, `.`, `/`.
3. O sufixo não é removido. `PK2052602` não corresponde a `PK2052602TJ`.
4. Código de item, referência incompleta e processo legado fora da planilha não
   autorizam vínculo, criação nem leitura da pasta.
5. Sem configuração, sem primeiro snapshot ou durante indisponibilidade sem
   cache, o sistema falha fechado: não vincula, não cria e não importa.
6. Um último snapshot válido pode ser usado como cache marcado `stale` durante
   indisponibilidade temporária. O TTL padrão é dez minutos.
7. `DOCUMENT_SOURCE=drive` é o padrão. Nesse modo:
   - os jobs de e-mail não ingerem anexos;
   - `POST /api/documents/upload` responde `409` antes de o arquivo temporário
     ser criado;
   - a interface substitui o upload por orientação para usar a pasta do
     processo;
   - a varredura só lê processos presentes no snapshot do Follow Up.
8. Arquivos são deduplicados por `driveFileId`; documentos e Espelhos já
   publicados são considerados na deduplicação.
9. A origem é persistida em `documents.ingestion_source` (`drive`, `email`,
   `manual` ou `legacy`) e exibida ao operador. Registros anteriores permanecem
   `legacy` para não inventar procedência.
10. Arquivos baixados do Drive são validados por extensão, MIME declarado,
    tamanho e assinatura real antes da persistência. Conteúdo incompatível é
    rejeitado e contabilizado como falha da varredura.

## Contrato de completude da extração

- `processado`, confiança, cobertura de campos e acurácia são estados
  diferentes.
- Extração vazia ou sem dados úteis é falha explícita, não sucesso com campos
  `-`.
- Documento abaixo do piso de confiança não alimenta silenciosamente o dado
  operacional; permanece como evidência para conferência/reprocessamento.
- A tela mostra cobertura, campos ausentes, baixa confiança e motivo da falha.
- Acurácia só pode ser medida contra documento original e ground truth humano.

## Dados e reconciliação

- Processos antigos fora do Follow Up não são excluídos automaticamente; apenas
  deixam de alimentar a ingestão. Remoção ou remanejamento exige decisão humana.
- A varredura não cria pastas nem processos. O processo deve existir no sistema
  e a pasta deve seguir a convenção `raiz/Marca/CODIGO` ou possuir
  `driveFolderId` conhecido.
- Arquivo não suportado é ignorado com telemetria. Arquivo suportado cujo nome
  não permite classificação entra como `other` e exige classificação humana.

## Observabilidade e bloqueios

- `GET /health/integrations` informa se Drive e Follow Up estão configurados e
  acessíveis, sem expor identificadores ou credenciais.
- O boot registra a política ativa e a varredura registra importados, ignorados,
  falhas e processos sem pasta/fora do Follow Up.
- Configuração ausente é bloqueio operacional, não motivo para voltar
  silenciosamente ao fluxo antigo.

## Rollback controlado

O comportamento histórico continua disponível apenas por decisão explícita:

- `DOCUMENT_SOURCE=both` ou `email` reabilita as fontes correspondentes e o
  upload manual;
- `PROCESS_REFERENCE_SOURCE=legacy` reabilita a regra anterior.

Essas mudanças ampliam a fonte autorizada e devem passar por nova aprovação da
operação. Não são fallback automático.

## Critérios de aceite antes de produção

1. Migration `0026_document_ingestion_source.sql` aplicada pela rotina oficial.
2. IDs reais do Drive e do Follow Up presentes no cofre/SOPS e transmitidos ao
   contêiner.
3. Pasta e planilha compartilhadas em modo leitor com a conta de serviço.
4. `GET /health/integrations` sem avisos de Drive/Follow Up.
5. Smoke com um processo listado, um processo fora da lista, um PDF e um XLSX.
6. Conferência humana dos campos de Invoice, Packing List e BL da amostra.

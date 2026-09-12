# Reuniao de 11/09/2026 — importacao e certificacao

Registro da rodada que atendeu a reuniao com Eduarda De Souza e Odett Hammes (mais Leticia Bicca),
os 15 prints enviados depois dela e a revisao dos pedidos. Estado: **implementado e integrado na
branch local `fix/reuniao-2026-09-11`; nada publicado**. Sem push, sem deploy, sem escrita em
producao, Linx, Drive, Sheets ou VTEX.

## 1. Escopo

Fonte: transcricao da reuniao, resumo enviado pelo usuario e 15 capturas de tela (`Importacao/*.png`).
Restricao declarada pelo usuario: **nao alterar as colunas e os dados trazidos das fontes** — toda
correcao e na leitura, na regra, no nosso banco ou na tela.

## 2. Metodo

Trabalho em tres fases, com agentes em paralelo e um orquestrador integrando:

1. **Diagnostico (somente leitura)** — 9 times especializados mais um critico de completude que
   cruzou os achados com a transcricao. Resultado: 73 achados com evidencia (arquivo:linha, SELECT
   em producao ou teste), 10 contradicoes entre times e um mapa de conflito de arquivos.
2. **Implementacao** — uma fundacao compartilhada no tree principal e depois um time por frente,
   cada um em `git worktree` isolado, com branch propria e gates antes de cada commit. A primeira
   rodada perdeu 6 de 8 times por **limite de uso da sessao** (nao por erro tecnico); os 6 foram
   relancados depois e entregaram.
3. **Integracao** — merges feitos pelo orquestrador na `fix/reuniao-2026-09-11`, com gates completos
   no estado integrado.

Decisoes que resolveram contradicoes entre times (capa, casamento de item, contrato do checklist,
schema da certificacao, escrita no Linx) estao em `.context`/scratchpad da sessao e resumidas na
secao 6. As que dependem do time fiscal estao em
[decisoes abertas](DECISOES-ABERTAS-2026-09-11.md).

## 3. O que foi entregue, por pedido da reuniao

### Leitura de documentos pelo Drive

- Indice da pasta `PROCESSOS` montado por varredura, com prioridade **por tipo de documento**:
  o arquivo em `04. PENDENTES DE CORRECAO` vence, e os tipos que faltam vem da pasta da marca.
- Estrutura real coberta: `PUKET/<ano>/` com processo direto ou colecao; `IMAGINARIUM/<ano>/FAT <mes>/`;
  pastas duplicadas com o mesmo codigo; nomes com sufixo e espaco no fim; nomes legados curtos
  ignorados; **o ano da pasta e o da colecao, nunca o do codigo** (PK219 e PK220 estao em
  `PUKET/2027/HIGH SUMMER`).
- Espelho passa a vir so de `01. ESPELHOS`, aceitando Google Sheets nativo (via export) e `.xlsx`.
- Identidade do documento passou a ser o **conteudo** (`content_sha256`/`drive_md5`), o que evita
  duplicata entre pasta duplicada, upload manual e reimportacao.
- Integracao **somente leitura** por padrao (`DRIVE_WRITE_MODE`): o sistema nao escreve em `PROCESSOS`.
- Documento excluido **nao volta**: o sweep consulta `document_ingestion_tombstones`.
- Arquivos que nao sao documento do fluxo (CT-e, fatura, manifesto) e subpasta `Backup` nao viram
  documento, para a primeira varredura nao abrir uma enxurrada de alertas.

### Extracao (BL, packing list, invoice)

- Causa raiz do BL provada offline com os arquivos reais: os PDFs tem camada de texto CID
  (Adobe-GB1, sem ToUnicode) que o servidor le **vazia**. Como o OCR respondia alguma coisa, o PDF
  original nunca chegava ao modelo, que recebia um formulario em branco. Agora o PDF original vai
  anexado sempre que o provider aceita PDF, e o OCR entra so como apoio.
- Fim do dado inventado a partir do gabarito: container exige ISO 6346 valido (fim do
  `Numero container: ainers`), identificadores exigem digito e tamanho minimo, e o que vem do texto
  vale menos na nota.
- O OHBL do PK220 tinha sido lido corretamente e caia para 0,39 por tres falsos positivos do
  verificador; os tres foram corrigidos.
- Packing list passou a fornecer CBM, quantidade e fabricante.

### Comparativo

- Um unico resumo clicavel e colorido (o bloco duplicado so-visual saiu).
- Cruzamentos deixaram de ser linha de texto "esperado x encontrado": entraram nas colunas
  Invoice / Packing / BL / Espelho / Sistema das linhas de cima, com a regra na mensagem.
- CNPJ comparado so pelos digitos (o "mesmo CNPJ" com e sem pontuacao nao e mais divergencia).
- Casamento de item corrigido na LEITURA, sem alterar o dado extraido: o codigo entre colchetes da
  descricao e o candidato primario, e o codigo composto (PI + colecao + codigo) casa pelo sufixo.
- "Todos os N itens da Invoice foram encontrados" aparece quando nao ha pendencia.
- O exportador deixou de ser preenchido por um fallback do cadastro quando nao ha espelho.
- Coluna Sistema passou a vir do cadastro do processo, inclusive com validacao parcial.

### Follow Up, datas e capa do processo

- Sincronizacao recorrente da planilha para o nosso banco, mapeada **por cabecalho** (tolera coluna
  inserida), com `#ERROR!`, `-` e vazio tratados como indisponivel — nunca viram zero.
- Atracacao passou a usar `ETA Realizado` (ou `ETA Final*`), nunca `ETA Previsto Medio` — era a
  origem do "ETA 16/09" quando as tres datas reais eram 08/09.
- "Registrado" mostra numero e data da DUIMP.
- Data um dia antes corrigida na raiz: formatador unico de data, que le a data de calendario do
  texto em vez de converter para o fuso do navegador.
- Capa com precedencia por campo: Follow Up primeiro no que ela tem, documentos completam o resto
  (com o packing list como fonte de pesos, caixas e CBM) e a divergencia fica visivel.
- Estagio logistico so avanca por evento **realizado**, e pode ser corrigido para tras.

### Tela do processo, checklist e documentos

- Barra fixa compactada em uma linha, com observacao inline; o status aparece em portugues
  ("Aguardando correcao"), nao mais `pending_correction`.
- Ciclo de transporte subiu para logo depois do cabecalho.
- Checklist com fonte unica no servidor: etapas especificas aparecem **dentro** do checklist, na
  linha escolhida; a aba "Etapas" foi removida. "Coletar Assinaturas" e "Enviar Docs Assinados"
  sairam da rotina sem apagar coluna nem dado.
- Exclusao de documento liberada para analista, com motivo obrigatorio, auditoria, evento no
  historico e tombstone.

### Certificacao e licenciamento

- Aba "Puket escolares" deixou de ser lida; ficam Imaginario, PUC e Encerramentos.
- **Status pela coluna U (situacao)** e **trava pela menor data** entre fim de venda da certificacao
  e fim do licenciamento, descartando nulo e a sentinela 01/01/1900.
- Certificado **ativo nunca tem data de trava** (o caso da Vitrola e do Karaoke).
- Dupla certificacao resolvida: a linha ativa vence, e o encerramento so vale quando nao ha ativa.
- Cadastro ganhou "fim de venda", vinculo de itens em massa e remocao individual; o numero do
  certificado aparece na lista de produtos e na busca.
- Botao de sincronizar a planilha na hora, com trava contra execucao concorrente e historico de
  execucoes, mais job horario so da planilha.
- Auditoria do marketplace da Imaginarium (quebra-cabecas de terceiros) com a regra de 500 pecas.
- Carga do zero no Linx: **so dry-run**, com relatorio antes/depois por SKU. Nada foi executado.

### Alertas no Google Chat

- Fim do card por processo parado: um digest em dia util as 09:00, so quando o conjunto muda.
- "Sem movimentacao" deixou de ser `updated_at` antigo e passou a ser "fora do esperado para a
  fase". Com os dados de 11/09, de 28 processos alertados para 4.
- Mensagem de falha de validacao passou a ter caminho unico de entrega, sem repetir a cada
  reprocessamento; mensagens do mesmo processo caem no mesmo topico.

## 4. Evidencias

Gates rodados pelo orquestrador no estado integrado (nao apenas relatados pelos agentes):
ver secao "Validacao final" ao fim deste documento.

Linha de base antes de qualquer mudanca, no mesmo dia: typecheck ok, API 1.608 testes + 1 ignorado,
web 245, cert-api 595.

Verificacoes de producao usadas como evidencia foram **somente leitura** (SELECT e leitura do Drive
com a conta de servico). Nenhum documento real de cliente ou fornecedor foi versionado; as fixtures
sao sinteticas com a mesma estrutura.

## 5. O que NAO foi feito

- **Registro/DUIMP (onda C)**: o comparativo DUIMP x espelho x invoice foi desenhado no diagnostico
  (REG-01 a REG-07) e **nao foi implementado**. A aba Registro continua sem usar o rascunho.
- **Revisao adversarial cruzada** das entregas: nao houve. Cada time revisou o proprio diff e o
  orquestrador revisou fundacao, exclusao de documento e regra de alertas.
- **CMP-07 etapa 2**: comparar mais campos do cabecalho do espelho depende de um espelho oficial de
  exemplo lido do Drive.
- **Cronograma no Sheets** com fases e prazos (pedido da reuniao) nao foi criado.
- **Itens marcados `partial`** pelos times: CERT-03, CERT-06 e o contrato D11 do lado de regras;
  CFN-01, CFN-03, CFN-07; CMP-07. Detalhe no retorno de cada time (scratchpad da sessao).
- **CFN-08 e CFN-09** ficaram sem codigo por divisao de arquivos entre os dois times de certificacao.
- **Dockerfile da API** ganhou `poppler-data` e fonte CJK, mas **o build da imagem nao foi executado**.

## 6. Decisoes adotadas (reversiveis)

Tomadas pelo orquestrador para destravar contradicoes entre times. Cada uma pode ser trocada:

1. Drive: prioridade por tipo de documento, nao "pasta inteira vence".
2. Drive: integracao somente leitura; o sistema nao escreve em `PROCESSOS`.
3. Capa: Follow Up primeiro nos campos que ela tem; documento completa e sinaliza divergencia.
4. Sync da Follow Up: nasce em `dry_run`, sem gravar, ate autorizacao explicita.
5. Item: casamento na leitura, sem alterar o dado extraido.
6. Comparativo: integracao indisponivel e dado ausente na fonte viram "Nao verificado — motivo",
   visiveis e fora da contagem de atencoes.
7. Checklist: catalogo unico no servidor; etapas obsoletas inativas sem apagar dado.
8. Exclusao de documento: qualquer documento, com motivo obrigatorio e rastro.
9. Registro/DUIMP: desenho aprovado, implementacao adiada.
10. Alertas: digest diario em dia util, cadencia de 5 dias uteis por processo.
11. Certificacao: contrato de dados unico; status por U; trava pela menor data; ativo sem trava;
    escrita no Linx so com fim de venda e nunca para certificado ativo.

A regra dos "90%" do BL foi interpretada como **faixa de revisao**, nao como piso para usar o
documento: com o piso literal, praticamente todos os BLs de hoje ficariam sem uso. Ver decisao 6 do
documento de decisoes abertas.

## 7. Sequencia para ativar (fora do codigo)

1. **Compartilhamento do Drive** — feito em 11/09: a conta de servico ja le `PROCESSOS`,
   `04. PENDENTES DE CORRECAO` e `01. ESPELHOS`.
2. **Backfill de `content_sha256`** dos documentos ja existentes — **obrigatorio antes** de virar a
   fonte para o Drive, senao os arquivos subidos a mao entram de novo como duplicata.
3. **SOPS**: `GOOGLE_DRIVE_ROOT_FOLDER_ID` (hoje e o placeholder `your-root-folder-id`) e
   `DOCUMENT_SOURCE=drive` (hoje `email`).
4. **Deploy** — aplica as migrations 0029 e 0030 e o DDL da cert-api. Atencao: o
   `apply-pending-migrations.sh` estava parado na 0026; as 0027 e 0028 so entravam pelo boot da API.
   Isso foi corrigido nesta rodada.
5. **Follow Up**: virar `FOLLOW_UP_SYNC_MODE` para `apply` depois de conferir o diff do dry-run.
6. **Certificacao**: aceite fiscal do relatorio antes/depois antes de qualquer carga no Linx.

## 8. Mudancas visiveis que o time vai notar

- ~107 SKUs com certificado encerrado passam de "Ativo" para "Encerrado" (a venda segue liberada ate
  o fim de venda) e 3 voltam para "Ativo". **Depende de aceite fiscal.**
- O progresso do checklist muda de denominador (15 para 13 etapas ativas).
- A contagem do comparativo cai, porque os cruzamentos viraram status das linhas de cima.
- A exclusao de documento e definitiva: nao ha soft-delete.

## 9. Validacao final

Rodada pelo orquestrador na branch integrada, depois dos oito merges:

```
npm run typecheck                       # ok
npm test -w apps/api                    # 183 arquivos, 1.919 testes, 5 ignorados
npm test -w apps/web                    # 59 arquivos, 356 testes
cd apps/cert-api && python3 -m pytest -q # 772 testes
npm run lint                            # ok
npm run build                           # ok
```

Comparacao com a linha de base do mesmo dia, antes de qualquer mudanca:

| Gate                     | Antes              | Depois              |
| ------------------------ | ------------------ | ------------------- |
| API                      | 1.608 + 1 ignorado | 1.919 + 5 ignorados |
| Web                      | 245                | 356                 |
| cert-api                 | 595                | 772                 |
| typecheck / lint / build | ok                 | ok                  |

Sao 599 testes novos, sem regressao.

Os 4 ignorados a mais sao do teste **opt-in** `extract-text-bl-real-pdf.test.ts`, que prova a causa
raiz do BL com os PDFs reais. Ele so roda quando alguem aponta a variavel de ambiente para uma pasta
com esses arquivos, porque documento real de fornecedor nao pode ser versionado. O quinto ignorado e
o `validate-live.test.ts`, que ja existia e depende de provider ao vivo.

**Limites desta validacao:** nenhuma tela foi aberta em navegador nesta rodada (a conferencia de tema
escuro e de 375 px foi estatica, com tokens ja existentes); o indice do Drive foi validado contra
fixture sintetica derivada da arvore real, e nao contra a API do Google; o `linx_attributes.py` nunca
rodou contra o SQL Server real; e a imagem Docker com `poppler-data` nao foi construida.

# Teste de Aceitação do Usuário (UAT) — Eduarda

> Roteiro prático para a Eduarda confirmar, ponto a ponto, que cada item do seu
> feedback foi resolvido. Não é necessário conhecimento técnico: siga os passos,
> compare com o resultado esperado e marque **PASSOU** ou **FALHOU**.
> Build: `fix/eduarda-enterprise`. Data-base: 2026-06-19.

## Como usar este roteiro

- Faça em **staging** (ambiente de teste), não em produção.
- Para cada caso: leia a **Pré-condição**, siga os **Passos**, confira o
  **Resultado esperado** e marque a caixa.
- Se algo não bater, marque **FALHOU** e escreva o que viu no campo de observação.

> **Antes de começar — pré-requisitos (peça ao time técnico para confirmar):**
> 1. Os **documentos reais** da sua demonstração foram carregados (Invoice,
>    Packing List, BL, Proforma). Se a extração vier fraca, o time vai trocar o
>    provedor de IA para Vertex (#60).
> 2. Os destinatários de e-mail **KIOM, FENICIA e ISA** estão cadastrados em
>    *Configurações > Destinatários operacionais* (#78).
> 3. A planilha **"Licenciamentos Vencidos"** de teste está conectada (#87).
>
> Enquanto esses três não estiverem resolvidos, o resultado vale só para
> staging — não é aceite de produção.

---

# PARTE 1 — IMPORTAÇÃO

## Bloco A — Status logístico

### A1. Processo "em trânsito" automático quando a data de embarque (ETD) já passou
- **Pré-condição:** abrir um processo cujo ETD/data de embarque seja anterior a hoje.
- **Passos:**
  1. Abra o processo na lista de processos.
  2. Olhe a barra de status logístico no topo.
- **Resultado esperado:** a etapa **"Em Trânsito"** aparece marcada
  automaticamente (sem você precisar mudar nada), porque o embarque já ocorreu.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### A2. Controle — processo com ETD no futuro não fica "em trânsito"
- **Pré-condição:** abrir um processo cujo ETD seja uma data futura e sem embarque registrado.
- **Passos:** abra o processo e olhe a barra logística.
- **Resultado esperado:** o processo **não** aparece como "Em Trânsito" (fica numa etapa anterior).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco B — Cartão de informações do processo (dados do BL)

### B1. Data de Embarque, Frete e Container vêm do BL
- **Pré-condição:** processo com BL (Bill of Lading) que tenha Data de Embarque, Frete e Container.
- **Passos:**
  1. Abra o processo.
  2. Localize o cartão de informações do processo.
- **Resultado esperado:** os campos **Data de Embarque**, **Frete** e
  **Container** aparecem preenchidos com os valores do BL (não em branco).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco C — Comparativo consolidado

### C1. Coluna "Sistema" e linhas de cruzamento entre documentos
- **Pré-condição:** processo com Invoice e Packing List.
- **Passos:**
  1. Abra o Comparativo do processo.
- **Resultado esperado:** existe uma única tabela consolidada com a coluna
  **"Sistema"** ao lado de Invoice e Packing List, e linhas de cruzamento entre
  documentos aparecem juntas no mesmo comparativo (não em telas separadas).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### C2. Anomalia "7 vs 1" resolvida — contagem determinística + itens não casados nos dois sentidos
- **Pré-condição:** par Invoice × Packing List com divergência de itens.
- **Passos:**
  1. Abra o Comparativo.
  2. Olhe a seção de itens / reconciliação.
- **Resultado esperado:** a contagem de itens é **estável e consistente** (a
  mesma sempre que reabre — sem o "7 vs 1" inconsistente de antes). Itens que
  estão na Invoice e não na Packing List, **e** os que estão na Packing List e
  não na Invoice, aparecem listados nos dois sentidos.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### C3. Peso líquido e peso bruto por item
- **Pré-condição:** documentos com peso por item.
- **Passos:** no Comparativo, olhe a tabela de itens.
- **Resultado esperado:** cada item mostra **Peso Líquido** e **Peso Bruto**
  separados.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### C4. Tooltip da nota de aceite
- **Pré-condição:** uma divergência que tenha sido aceita/justificada.
- **Passos:** passe o mouse sobre o item aceito no Comparativo.
- **Resultado esperado:** aparece um tooltip com a **justificativa** do aceite.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### C5. Check de tolerância de data Invoice × Packing List
- **Pré-condição:** Invoice e Packing List com datas divergentes em **mais de 30 dias**.
- **Passos:** abra a validação/comparativo do processo.
- **Resultado esperado:** aparece um **aviso** apontando a divergência de data
  entre Invoice e Packing List. (Com datas próximas, ≤ 30 dias, **não** deve
  acusar.)
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco D — Cobertura de extração

### D1. Banner "leu X% — campos não lidos"
- **Pré-condição:** documento em que a extração não conseguiu ler todos os campos.
- **Passos:** abra o resumo de extração de IA do documento.
- **Resultado esperado:** aparece um **banner de cobertura** dizendo quanto foi
  lido (ex.: "leu 78%") e **listando os campos não lidos / de baixa confiança** —
  respondendo diretamente à dúvida "leu só X%".
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### D2. Autocorreção da extração (self-repair)
- **Pré-condição:** documento com campos faltantes/baixa confiança na primeira leitura.
- **Passos:** processe a extração e observe o resultado.
- **Resultado esperado:** o sistema faz uma **nova tentativa automática** para
  recuperar campos faltantes, e o resultado final traz os campos de maior
  confiança consolidados (a cobertura tende a melhorar após o reprocessamento).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco E — Checklist documental

### E1. "Concluído por <nome>"
- **Pré-condição:** processo com checklist documental.
- **Passos:** marque uma etapa do checklist como concluída.
- **Resultado esperado:** a etapa passa a mostrar **"Concluído por <seu nome>"**
  com a data/hora.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco F — Proformas

### F1. Itens, FOB e download
- **Pré-condição:** processo com proforma que tenha itens.
- **Passos:** abra a aba de Proformas.
- **Resultado esperado:** a proforma mostra a **lista de itens**, o valor
  **FOB** (com moeda) e um **botão de download** funcional.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### F2. (Edge) Empty-state quando não há proforma / sem itens
- **Pré-condição:** processo sem proforma, ou proforma sem itens.
- **Passos:** abra a aba de Proformas.
- **Resultado esperado:** aparece uma **mensagem clara de "vazio"** — **não**
  pode quebrar a tela nem mostrar erro técnico.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco G — Espelho

### G1. (Edge) Abrir Espelho sem itens não pode quebrar
- **Pré-condição:** processo cujo espelho não tenha itens.
- **Passos:** abra o Espelho desse processo.
- **Resultado esperado:** o Espelho abre normalmente (vazio ou com aviso),
  **sem crash / tela branca / erro técnico**.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco H — E-mail operacional

### H1. Erro acionável quando o envio falha
- **Pré-condição:** tentar enviar para um destinatário **inválido / não
  cadastrado** (ou em branco).
- **Passos:** dispare o e-mail operacional.
- **Resultado esperado:** o sistema mostra uma **mensagem de erro clara e
  acionável** (explicando o que fazer, ex.: cadastrar o destinatário/ domínio
  permitido) — não um erro genérico.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### H2. Allow-list — só destinatários autorizados recebem
- **Pré-condição:** KIOM/FENICIA/ISA cadastrados (pré-requisito #78).
- **Passos:** envie o e-mail operacional para um destinatário autorizado.
- **Resultado esperado:** o envio ocorre para o destinatário **autorizado**;
  um destinatário **fora da allow-list é bloqueado**.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

---

# PARTE 2 — CERTIFICAÇÃO

## Bloco I — Status do certificado (somente Ativo / Encerrado)

### I1. PI4257Y deve aparecer "Encerrado"
- **Pré-condição:** lista de certificação carregada.
- **Passos:** busque o certificado **PI4257Y**.
- **Resultado esperado:** `cert_status` = **Encerrado** (estava "Ativo" mas o
  licenciamento/prazo venceu).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### I2. PI5101Y deve aparecer "Encerrado"
- **Pré-condição:** lista de certificação carregada.
- **Passos:** busque o certificado **PI5101Y**.
- **Resultado esperado:** `cert_status` = **Encerrado** (estava "Em andamento" e
  foi fechado).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### I3. Status do certificado nunca tem um terceiro valor
- **Pré-condição:** lista de certificação com vários produtos.
- **Passos:** percorra a coluna de status do certificado.
- **Resultado esperado:** todo certificado mostra **somente "Ativo" ou
  "Encerrado"** — nenhum outro valor (sem "Em andamento", "Vencido" etc. nessa
  coluna).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco J — Status no site (Conforme / Não conforme + motivo)

### J1. Apenas Conforme / Não conforme
- **Pré-condição:** lista carregada.
- **Passos:** percorra a coluna de status no site.
- **Resultado esperado:** somente **"Conforme"** ou **"Não conforme"** — nenhum
  outro valor.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### J2. "Não conforme" sempre traz um motivo
- **Pré-condição:** ao menos um produto "Não conforme".
- **Passos:** abra/observe um item marcado como "Não conforme".
- **Resultado esperado:** há sempre um **motivo/justificativa** acompanhando o
  "Não conforme" (ex.: "Certificação encerrada com produto no site",
  "Frase de certificação obrigatória ausente", "Verificação pendente").
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco K — Licenciamento (planilha "Licenciamentos Vencidos")

### K1. Status e prazo de licença vêm da planilha
- **Pré-condição:** planilha "Licenciamentos Vencidos" de teste conectada (#87),
  com um SKU VÁLIDO e um VENCIDO.
- **Passos:** localize um produto com licença VÁLIDA e outro com VENCIDA.
- **Resultado esperado:** `license_status` mostra **Válido / Vencido /
  Não aplicável** conforme a planilha, e o **prazo (validade)** bate com a
  planilha. (Produto sem linha na planilha → "Não aplicável".)
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

## Bloco L — Filtros multi-eixo (server-side)

### L1. Filtrar por status do certificado
- **Pré-condição:** lista com produtos Ativo e Encerrado.
- **Passos:** filtre por **Encerrado**.
- **Resultado esperado:** a lista mostra **apenas** Encerrados, e o
  **total/paginação** reflete a quantidade filtrada (não o total geral).
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### L2. Combinar eixos (certificado + site)
- **Pré-condição:** lista variada.
- **Passos:** aplique ao mesmo tempo um filtro de status do certificado **e** de
  status no site.
- **Resultado esperado:** a lista mostra só os produtos que atendem **aos dois**
  critérios (interseção), com total coerente.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

### L3. Filtro insensível a maiúsculas/minúsculas
- **Pré-condição:** lista carregada.
- **Passos:** filtre usando "ativo" em minúsculas.
- **Resultado esperado:** o filtro funciona igual, retornando os Ativos.
- ( ) PASSOU ( ) FALHOU — Obs.: ____________________

---

# Resumo / Veredito

| Bloco | Resultado |
|-------|-----------|
| A–H (Importação) | ( ) Tudo passou ( ) Pendências: ______ |
| I–L (Certificação) | ( ) Tudo passou ( ) Pendências: ______ |

- **Provedor de IA usado:** ( ) Local ( ) Vertex
- **Pré-requisitos resolvidos?** P1(#60) ( ) P2(#78) ( ) P3(#87) ( )
- **Veredito:** ( ) Aprovado p/ produção ( ) Aprovado staging-only ( ) Reprovado

Assinatura Eduarda: __________________  Data: ________

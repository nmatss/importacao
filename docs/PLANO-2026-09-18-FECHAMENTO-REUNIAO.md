# Correções e validação do aceite da reunião

Autorização: usuário pediu corrigir e validar todos os achados da auditoria de Odett/Eduarda.
Preservar colunas/fontes externas, alterações preexistentes e controles de publicação do AGENTS.md.

## Sequência

1. Corrigir independência dos valores comparados, estado incompleto, identificadores de planilha
   e reconhecimento de dupla certificação; testes de regressão reproduzindo a auditoria.
2. Resolver seleção explícita e proveniência de documentos/versões para comparativo e Registro;
   recuperar leitura dos pilotos com diagnósticos sem alterar originais.
3. Integrar correções locais de certificação/cadastro e revisar atualização Follow-up e Linx,
   com validação de banco isolado, reconciliação e plano de aplicação revisável.
4. Corrigir os achados de UX/UI dentro dos fluxos identificados e validar no navegador.
5. Rodar gates API/web/certificação, revisar diffs, registrar evidências e preparar publicação.
6. Publicação segue o gate existente: master limpo/sincronizado e scripts/deploy.sh; push requer
   autorização explícita. Dados de fonte corrompidos e ambiguidades de negócio não serão inventados.

## Critério

Não confundir teste local aprovado com atualização produtiva. Cada achado deverá registrar código,
teste, dados reais quando disponíveis e eventual dependência da área ou da publicação. A conclusão
global só pode ser declarada após os fluxos operacionais exigidos terem evidência.

## Checkpoint após implementação

Etapas 1, 3 (código/testes) e 4 implementadas. Etapa 2 inclui inspeção explícita de versões e
recuperação DUIMP, mas mantém bloqueios de fonte e BL PK219. Etapa 5 tem suites e auditoria
executadas; release ainda não publicado. Etapa 6 depende do gate explícito de push e das
validações operacionais descritas no [relatório](STATUS-2026-09-18-CORRECOES-ACEITE.md).

# Pedido de acesso de leitura — classes financeiras (SYDLE One)

Rascunho para enviar ao suporte/admin da SYDLE. **Não enviado** — revisar antes.

## Contexto

Integramos o relatório **Compras e Pagamentos Internacionais** do portal de
Importação à instância `grupounico.sydle.one` (app `main`), lendo, em modo
**somente leitura** (`signIn` + `_search`), a classe de pagamentos
`68bf1179b042c72f03993928` e as classes vizinhas do fluxo.

Um probe read-only (2026-06-21) confirmou que conseguimos ler: pagamentos,
ticket, ticket_status, currency, brand, recipient, enterprise e as classes de
sistema (usuário/processo). Com isso já trazemos **código do processo, invoice,
marca e fornecedor**.

Faltam os dados **financeiros** (taxa de câmbio, valor em BRL, banco, contrato de
câmbio, proforma/PI e remessa/SWIFT). Eles **não vêm** no payload da classe de
pagamentos — estão em duas classes que retornam **HTTP 403** para o nosso
usuário de integração.

## O que pedimos

Conceder **permissão de leitura (read-only)** ao usuário de integração
`nicolas.matsuda@grupounico.com` (ou a um usuário de serviço dedicado, se
preferirem) sobre as duas classes abaixo — ou, alternativamente, expor uma
**view/relatório/API consolidada** com esses campos:

| Classe (`_classId`)        | Como é referenciada no fluxo            | Suspeita de conter                                 |
| -------------------------- | --------------------------------------- | -------------------------------------------------- |
| `68bf1179b042c72f03995efb` | `_concreteObject` do registro de pagto. | Form detalhado do pagamento (proforma/PI, câmbio?) |
| `64f22b57e85f4a4b92376c43` | `processInstanceControl.activeElements` | Atividade do BPM (câmbio/banco/contrato/remessa?)  |

Campos de destino no nosso relatório: `exchange_rate`, `amount_brl`,
`bank_name`, `contract_number`, `proforma_number`, `remittance_id`.

## Observações

- Uso estritamente **read-only**; não escrevemos nada na SYDLE.
- Se houver restrição a campos sensíveis (dados bancários), uma view só com
  câmbio/BRL/contrato/proforma já resolve a maior parte.
- Assim que o acesso for liberado, rodamos o probe de novo (as classes passam a
  200), mapeamos o caminho dos campos e ligamos o enriquecimento — sem nova
  alteração de contrato de acesso.

## Segurança (nosso lado)

O `signIn` da SYDLE One só aceita **GET com login/senha na query string**
(POST → HTTP 405). Isso expõe a credencial a logs de proxy/WAF. Pedimos também,
se possível, um método de **autenticação por token/header ou POST**, para
eliminarmos esse risco. Enquanto isso, rotacionamos a senha periodicamente.

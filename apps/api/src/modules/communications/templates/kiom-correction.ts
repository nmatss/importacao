interface FailedCheck {
  checkName: string;
  expectedValue?: string;
  actualValue?: string;
  message: string;
}

interface CorrectionData {
  processCode: string;
  brand: string;
  failedChecks: FailedCheck[];
}

export function kiomCorrectionTemplate(data: CorrectionData) {
  const subject = `Correção Necessária - ${data.processCode} - ${data.brand}`;

  const checkRows = data.failedChecks.map((check, i) => `
    <tr style="${i % 2 === 0 ? 'background-color: #f5f5f5;' : ''}">
      <td style="padding: 8px; border: 1px solid #ddd;">${check.checkName}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${check.expectedValue || '-'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${check.actualValue || '-'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${check.message}</td>
    </tr>`).join('');

  const body = `
<div style="font-family: Arial, sans-serif; color: #333;">
  <h2>Correção de Documentos Necessária</h2>
  <p>Prezados,</p>
  <p>Após conferência dos documentos do processo <strong>${data.processCode}</strong> (${data.brand}), foram identificadas as seguintes discrepâncias que necessitam correção:</p>

  <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
    <thead>
      <tr style="background-color: #e74c3c; color: white;">
        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Verificação</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Valor Esperado</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Valor Encontrado</th>
        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Detalhes</th>
      </tr>
    </thead>
    <tbody>${checkRows}
    </tbody>
  </table>

  <p>Solicitamos o envio dos documentos corrigidos com a maior brevidade possível.</p>
  <p>Qualquer dúvida, estamos à disposição.</p>

  <p>Atenciosamente,<br/>Equipe de Importação</p>
</div>`.trim();

  return { subject, body };
}

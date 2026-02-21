interface ProcessData {
  processCode: string;
  brand: string;
  exporterName?: string;
  importerName?: string;
  totalFobValue?: string;
  incoterm?: string;
  totalBoxes?: number;
  portOfLoading?: string;
  portOfDischarge?: string;
  etd?: string;
  eta?: string;
}

export function feniciaSubmissionTemplate(data: ProcessData) {
  const subject = `Documentos de Importação - ${data.processCode} - ${data.brand}`;

  const body = `
<div style="font-family: Arial, sans-serif; color: #333;">
  <h2>Documentos de Importação</h2>
  <p>Prezados,</p>
  <p>Segue em anexo a documentação referente ao processo de importação abaixo descrito para registro e providências junto à Fenícia.</p>

  <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Processo</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.processCode}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Marca</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.brand}</td>
    </tr>
    ${data.exporterName ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Exportador</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.exporterName}</td>
    </tr>` : ''}
    ${data.importerName ? `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Importador</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.importerName}</td>
    </tr>` : ''}
    ${data.totalFobValue ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Valor FOB</td>
      <td style="padding: 8px; border: 1px solid #ddd;">USD ${data.totalFobValue}</td>
    </tr>` : ''}
    ${data.incoterm ? `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Incoterm</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.incoterm}</td>
    </tr>` : ''}
    ${data.totalBoxes ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Total de Volumes</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.totalBoxes}</td>
    </tr>` : ''}
    ${data.portOfLoading ? `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Porto de Embarque</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.portOfLoading}</td>
    </tr>` : ''}
    ${data.portOfDischarge ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Porto de Descarga</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.portOfDischarge}</td>
    </tr>` : ''}
    ${data.etd ? `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">ETD</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.etd}</td>
    </tr>` : ''}
    ${data.eta ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">ETA</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.eta}</td>
    </tr>` : ''}
  </table>

  <p>Solicitamos a conferência dos documentos e início do processo de desembaraço.</p>
  <p>Qualquer dúvida, estamos à disposição.</p>

  <p>Atenciosamente,<br/>Equipe de Importação</p>
</div>`.trim();

  return { subject, body };
}

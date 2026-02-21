interface ProcessData {
  processCode: string;
  brand: string;
  exporterName?: string;
  importerName?: string;
  totalFobValue?: string;
  totalBoxes?: number;
  eta?: string;
}

export function isaCertificationTemplate(data: ProcessData) {
  const subject = `Certificação ISA - ${data.processCode} - ${data.brand}`;

  const body = `
<div style="font-family: Arial, sans-serif; color: #333;">
  <h2>Solicitação de Certificação ISA</h2>
  <p>Prezados,</p>
  <p>Solicitamos a certificação dos produtos referentes ao processo de importação abaixo para atendimento às exigências regulatórias.</p>

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
    ${data.totalBoxes ? `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Total de Volumes</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.totalBoxes}</td>
    </tr>` : ''}
    ${data.eta ? `
    <tr style="background-color: #f5f5f5;">
      <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Previsão de Chegada</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${data.eta}</td>
    </tr>` : ''}
  </table>

  <p>Os documentos técnicos e amostras seguem em anexo para análise e emissão dos certificados necessários.</p>
  <p>Solicitamos prioridade no atendimento considerando os prazos de desembaraço.</p>

  <p>Atenciosamente,<br/>Equipe de Importação</p>
</div>`.trim();

  return { subject, body };
}

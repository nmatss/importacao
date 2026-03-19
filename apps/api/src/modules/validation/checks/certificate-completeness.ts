interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

export default function certificateCompleteness(input: CheckInput): CheckResult {
  const checkName = 'certificate-completeness';

  const hasCertification = input.processData?.hasCertification === true;
  const items = input.invoiceData?.items ?? [];

  // Check if any items require certification
  const itemsRequiringCert = items.filter(
    (item: any) =>
      item.requiresCertification === true || item.requiresCertification?.value === true,
  );

  // If process doesn't have certification flag and no items require it, skip
  if (!hasCertification && itemsRequiringCert.length === 0) {
    return {
      checkName,
      status: 'passed',
      documentsCompared: 'Processo',
      message: 'Processo não requer certificação.',
    };
  }

  // Process requires certification — check if certificate document exists
  // We check via processData which should have aiExtractedData with a 'certificate' key
  const aiData = input.processData?.aiExtractedData as Record<string, any> | undefined;
  const certData = aiData?.certificate;

  if (!certData) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Certificado presente',
      actualValue: 'Nenhum certificado encontrado',
      documentsCompared: 'Processo vs Certificado',
      message: `Processo marcado como requer certificação${
        itemsRequiringCert.length > 0
          ? ` (${itemsRequiringCert.length} item(ns) requerem certificação)`
          : ''
      }, mas nenhum certificado foi recebido.`,
    };
  }

  // Certificate exists — check basic completeness
  const issues: string[] = [];

  const certType = certData.certificateType?.value ?? certData.certificateType;
  const certNumber = certData.certificateNumber?.value ?? certData.certificateNumber;
  const expirationDate = certData.expirationDate?.value ?? certData.expirationDate;

  if (!certNumber) {
    issues.push('Número do certificado ausente');
  }

  if (!certType) {
    issues.push('Tipo de certificado não identificado');
  }

  // Check if certificate is expired (date-only comparison to avoid timezone issues)
  if (expirationDate) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const expStr = String(expirationDate).slice(0, 10);
    if (expStr < today) {
      issues.push(`Certificado vencido em ${expirationDate}`);
    }
  }

  if (issues.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Certificado completo e válido',
      actualValue: issues.join('; '),
      documentsCompared: 'Certificado',
      message: `Certificado presente mas com pendências: ${issues.join('. ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: 'Certificado presente e completo',
    actualValue: `${certType} - ${certNumber}`,
    documentsCompared: 'Processo vs Certificado',
    message: `Certificado ${certType} (${certNumber}) presente e válido.`,
  };
}

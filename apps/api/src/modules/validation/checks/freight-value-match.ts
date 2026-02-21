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

export default function freightValueMatch(input: CheckInput): CheckResult {
  const checkName = 'freight-value-match';

  const blFreight = input.blData?.freightValue != null ? Number(input.blData.freightValue) : null;
  const followUpFreight = input.followUpData?.freightValue != null ? Number(input.followUpData.freightValue) : null;

  if (followUpFreight == null) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'BL vs Follow-up',
      message: 'Skipped: No freight value available in follow-up data.',
    };
  }

  if (blFreight == null) {
    return {
      checkName,
      status: 'warning',
      expectedValue: followUpFreight.toFixed(2),
      documentsCompared: 'BL vs Follow-up',
      message: 'Freight value not found in BL.',
    };
  }

  const difference = Math.abs(blFreight - followUpFreight);

  if (difference <= 0.01) {
    return {
      checkName,
      status: 'passed',
      expectedValue: followUpFreight.toFixed(2),
      actualValue: blFreight.toFixed(2),
      documentsCompared: 'BL vs Follow-up',
      message: 'Freight value matches between BL and follow-up data.',
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: followUpFreight.toFixed(2),
    actualValue: blFreight.toFixed(2),
    documentsCompared: 'BL vs Follow-up',
    message: `Freight value mismatch: BL=${blFreight.toFixed(2)} vs Follow-up=${followUpFreight.toFixed(2)} (diff: ${difference.toFixed(2)}).`,
  };
}

export type DocumentSource = 'email' | 'drive' | 'both';

export function getDocumentSource(): DocumentSource {
  const raw = (process.env.DOCUMENT_SOURCE || 'drive').toLowerCase();
  return raw === 'email' || raw === 'both' ? raw : 'drive';
}

export function isDriveIngestionEnabled(): boolean {
  const source = getDocumentSource();
  return source === 'drive' || source === 'both';
}

export function isEmailIngestionEnabled(): boolean {
  const source = getDocumentSource();
  return source === 'email' || source === 'both';
}

/** Manual multipart uploads are disabled while Drive is the sole authority. */
export function isManualDocumentUploadEnabled(): boolean {
  return getDocumentSource() !== 'drive';
}

export function getDocumentSourcePolicy() {
  const source = getDocumentSource();
  return {
    source,
    driveOnly: source === 'drive',
    driveIngestionEnabled: isDriveIngestionEnabled(),
    emailIngestionEnabled: isEmailIngestionEnabled(),
    manualUploadEnabled: isManualDocumentUploadEnabled(),
  };
}

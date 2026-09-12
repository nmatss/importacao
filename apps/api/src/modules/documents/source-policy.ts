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

/**
 * Upload manual pela tela — flag PROPRIA (D1/DRV-10, reuniao 11/09/2026).
 *
 * Ate aqui "Drive e a fonte" implicava "upload manual bloqueado" (409 em
 * POST /documents/upload). Em 11/09 o time dependeu justamente do upload manual
 * para os tres processos-piloto e para trocar o tipo e reprocessar; a decisao da
 * reuniao foi sobre e-mail x Drive, nao sobre tirar a mao da analista do
 * processo. `MANUAL_UPLOAD_ENABLED` separa as duas coisas, e o dedupe por
 * conteudo (content_sha256) impede que o mesmo arquivo entre duas vezes quando
 * ele tambem aparecer na pasta do Drive.
 *
 * Vazio = ausente = ligado (mesma convencao do resto do sistema).
 */
export function isManualDocumentUploadEnabled(): boolean {
  return process.env.MANUAL_UPLOAD_ENABLED?.trim() !== 'false';
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

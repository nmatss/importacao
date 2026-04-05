import path from 'node:path';

/**
 * Resolved absolute path for file uploads.
 * Use this constant everywhere — do not hard-code 'uploads' strings.
 */
export const UPLOAD_DIR = path.resolve('uploads');

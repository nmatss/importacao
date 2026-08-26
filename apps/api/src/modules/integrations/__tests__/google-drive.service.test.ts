import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  filesGet: vi.fn(),
  Drive: vi.fn(),
  GoogleAuth: vi.fn(),
}));

vi.mock('@googleapis/drive', () => ({
  auth: { GoogleAuth: driveMocks.GoogleAuth },
  drive_v3: { Drive: driveMocks.Drive },
}));

vi.mock('../../../shared/database/connection.js', () => ({ db: {} }));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ENV_KEYS = [
  'GOOGLE_DRIVE_CLIENT_EMAIL',
  'GOOGLE_DRIVE_PRIVATE_KEY',
  'GOOGLE_DRIVE_ROOT_FOLDER_ID',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

async function loadService() {
  vi.resetModules();
  return (await import('../google-drive.service.js')).googleDriveService;
}

describe('googleDriveService root health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.Drive.mockImplementation(function MockDrive() {
      return { files: { get: driveMocks.filesGet } };
    });
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL = 'service@example.test';
    process.env.GOOGLE_DRIVE_PRIVATE_KEY = 'test-key';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('confirms an accessible, non-trashed folder without mutating Drive', async () => {
    driveMocks.filesGet.mockResolvedValue({
      data: { id: 'root-folder', mimeType: 'application/vnd.google-apps.folder', trashed: false },
    });
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(true);
    expect(driveMocks.filesGet).toHaveBeenCalledWith({
      fileId: 'root-folder',
      fields: 'id,mimeType,trashed',
      supportsAllDrives: true,
    });
  });

  it('reports false when the configured folder is inaccessible', async () => {
    driveMocks.filesGet.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(false);
  });

  it('does not call Drive when the root is missing or a placeholder', async () => {
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'your-root-folder-id';
    const service = await loadService();

    await expect(service.testRootAccess()).resolves.toBe(false);
    expect(driveMocks.filesGet).not.toHaveBeenCalled();
  });
});

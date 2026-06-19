import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateDocumentWorkflow } from './queryInvalidation';

describe('invalidateDocumentWorkflow', () => {
  it('invalidates the proformas aggregate with the document workflow', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueryClient;

    await invalidateDocumentWorkflow(queryClient, '123');

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['proformas-aggregate', '123'],
    });
  });
});

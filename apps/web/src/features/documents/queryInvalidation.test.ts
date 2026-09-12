import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateDocumentWorkflow } from './queryInvalidation';

describe('invalidateDocumentWorkflow', () => {
  it('invalida o Registro após mutação documental sem invalidar outro processo', async () => {
    const client = new QueryClient();
    const key = ['documents', 'process', '123', 'registro-comparison'];
    const other = ['documents', 'process', '456', 'registro-comparison'];
    client.setQueryData(key, { status: 'match' });
    client.setQueryData(other, { status: 'match' });
    await invalidateDocumentWorkflow(client, '123');
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

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

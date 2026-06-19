import type { QueryClient } from '@tanstack/react-query';

export function invalidateDocumentWorkflow(queryClient: QueryClient, processId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['documents', processId] }),
    queryClient.invalidateQueries({ queryKey: ['proformas-aggregate', processId] }),
    queryClient.invalidateQueries({ queryKey: ['doc-comparison', processId] }),
    queryClient.invalidateQueries({ queryKey: ['validation', processId] }),
    queryClient.invalidateQueries({ queryKey: ['validation-report', processId] }),
    queryClient.invalidateQueries({ queryKey: ['process-events', processId] }),
    queryClient.invalidateQueries({ queryKey: ['process', processId] }),
    queryClient.invalidateQueries({ queryKey: ['follow-up', processId] }),
    queryClient.invalidateQueries({ queryKey: ['espelho', processId] }),
    queryClient.invalidateQueries({ queryKey: ['communications', processId] }),
    queryClient.invalidateQueries({ queryKey: ['communications'] }),
  ]);
}

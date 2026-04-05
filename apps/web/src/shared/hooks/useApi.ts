import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export function useApiQuery<T>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => api.get<T>(url),
    ...options,
  });
}

export function useApiMutation<T, V = unknown>(
  url: string,
  method: 'post' | 'put' | 'patch' | 'delete' = 'post',
  options?: Omit<UseMutationOptions<T, Error, V>, 'mutationFn'>,
) {
  return useMutation<T, Error, V>({
    mutationFn: (data) => {
      if (method === 'delete') {
        return api.delete<T>(url);
      }
      return api[method]<T>(url, data);
    },
    ...options,
  });
}

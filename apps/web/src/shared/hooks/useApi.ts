import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
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

/** Formato que `sendPaginated` devolve no backend. */
interface RespostaPaginada<T> {
  data: T[];
  pagination?: { total?: number; page?: number; limit?: number; pages?: number };
}

/** Teto do `limit` aceito pelos controllers. Pedir mais e silenciosamente cortado. */
const LIMITE_POR_PAGINA = 100;
/** Trava dura contra laco infinito se a paginacao vier inconsistente. */
const MAX_PAGINAS = 20;

/**
 * Busca TODAS as paginas de uma rota paginada.
 *
 * Existe porque varias telas pediam uma fatia e a tratavam como o conjunto
 * inteiro. Medido em 2026-08-29, com a base em ~117 processos:
 *
 * - o seletor de processo do cambio consultava `/api/processes` SEM `limit`, e
 *   o default do schema e 20: nenhum processo fora dos 20 mais recentes podia
 *   receber lancamento;
 * - Desembaraco e Numerario pediam `limit=100` e somavam essa fatia como se
 *   fosse o total, entao os cartoes de estatistica mostravam numero errado;
 * - o Follow Up pedia `limit=200` e o controller corta em 100, sem avisar.
 *
 * `truncated` existe para que o teto de seguranca acima nunca vire uma nova
 * fatia silenciosa: se ele for atingido, a tela tem como dizer.
 */
export function useAllPagesQuery<T>(
  key: readonly unknown[],
  baseUrl: string,
  options?: Omit<
    UseQueryOptions<{ data: T[]; total: number; truncated: boolean }>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<{ data: T[]; total: number; truncated: boolean }>({
    queryKey: key,
    queryFn: async () => {
      const acumulado: T[] = [];
      let pagina = 1;
      let paginas = 1;
      let total = 0;

      do {
        const separador = baseUrl.includes('?') ? '&' : '?';
        const resposta = await api.get<RespostaPaginada<T>>(
          `${baseUrl}${separador}page=${pagina}&limit=${LIMITE_POR_PAGINA}`,
        );
        const lote = resposta?.data ?? [];
        acumulado.push(...lote);
        total = resposta?.pagination?.total ?? acumulado.length;
        paginas = resposta?.pagination?.pages ?? 1;
        // Sem isto, uma resposta sem paginacao e com lote vazio giraria ate o teto.
        if (lote.length === 0) break;
        pagina += 1;
      } while (pagina <= paginas && pagina <= MAX_PAGINAS);

      return { data: acumulado, total, truncated: acumulado.length < total };
    },
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

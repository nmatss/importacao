import { useSyncExternalStore } from 'react';

/**
 * `true` quando a media query casa. Existe para os graficos Recharts, que
 * recebem tamanho e rotulos por prop e nao alcancam os prefixos responsivos do
 * Tailwind: a pizza com rotulos externos estourava a largura do cartao em
 * telas estreitas (auditoria responsiva 2026-09-06).
 *
 * Sem `matchMedia` (jsdom, SSR) responde `false`, ou seja, layout de desktop.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

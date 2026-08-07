import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renderiza overlays (`position: fixed`) direto no `<body>`.
 *
 * Por que existe: um ancestral com `transform`, `filter`, `perspective`,
 * `contain` ou `backdrop-filter` vira containing block de descendentes
 * `position: fixed` — o overlay deixa de se referenciar a viewport e passa a se
 * referenciar aquele ancestral. No portal isso nao acontecia por acidente: as
 * paginas usam animacoes de entrada com `transform`, entao todo modal montado
 * dentro do conteudo ficava fora do centro e com backdrop cobrindo so parte da
 * tela. O portal isola o overlay dessa cadeia de ancestrais de forma definitiva,
 * inclusive enquanto a animacao de entrada da pagina ainda esta rodando.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  // O portal so pode existir depois da montagem no cliente (document.body).
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}

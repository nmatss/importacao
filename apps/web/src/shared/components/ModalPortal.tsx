import { type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let openPortalCount = 0;
let originalBodyOverflow = '';

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
interface ModalPortalProps {
  children: React.ReactNode;
  onEscape?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function ModalPortal({ children, onEscape, initialFocusRef }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);
  const portalRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  // O portal so pode existir depois da montagem no cliente (document.body).
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = portalRef.current?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
    if (!dialog) return;

    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;

    if (openPortalCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openPortalCount += 1;

    const focusInitialElement = () => {
      const requested = initialFocusRef?.current;
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (requested && dialog.contains(requested) ? requested : (firstFocusable ?? dialog)).focus();
    };
    const animationFrame = window.requestAnimationFrame(focusInitialElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      const portals = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-portal]'));
      if (portals.at(-1) !== portalRef.current) return;

      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          element.getAttribute('aria-hidden') !== 'true' &&
          window.getComputedStyle(element).visibility !== 'hidden',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      openPortalCount = Math.max(0, openPortalCount - 1);
      if (openPortalCount === 0) document.body.style.overflow = originalBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [initialFocusRef, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div ref={portalRef} data-modal-portal className="contents">
      {children}
    </div>,
    document.body,
  );
}

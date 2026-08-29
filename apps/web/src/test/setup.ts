import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * O jsdom nao implementa `matchMedia` nem `ResizeObserver`, e as duas coisas sao
 * usadas por codigo compartilhado: `ThemeContext` le `matchMedia` para resolver
 * o tema do sistema, `AppLayout` le para decidir entre desktop e mobile, e o
 * Recharts observa o container.
 *
 * Sem estes stubs, qualquer teste que renderize uma tela dentro do
 * `ThemeProvider` — ou qualquer grafico — estoura com um erro que nao aponta
 * para a causa. Ate 2026-08-29 dois arquivos de teste resolviam isso
 * localmente, cada um do seu jeito, e o terceiro que precisasse repetiria a
 * descoberta.
 *
 * O STUB E CIENTE DA QUERY, e isso importa. `AppLayout.tsx:78-80` trata a
 * AUSENCIA de `matchMedia` como desktop:
 *
 *     typeof window.matchMedia !== 'function' ? true : matchMedia(q).matches
 *
 * Uma primeira versao deste arquivo devolvia `matches: false` para tudo e
 * quebrou quatro testes de `ImportacaoLayout` e `CertificacoesLayout`: a
 * aplicacao inteira passou a se comportar como mobile, o menu colapsou e os
 * itens de navegacao sumiram da arvore acessivel. Respondendo `true` para
 * `min-width` preservamos exatamente o default anterior.
 *
 * A definicao e condicional: um teste que precise de comportamento especifico
 * — mobile, ou tema escuro — continua podendo sobrescrever, como
 * `AppLayout.test.tsx` ja faz.
 */
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => {
    // `min-width` -> desktop (o default historico). `prefers-color-scheme:
    // dark` e o resto -> false, ou seja, tema claro.
    const matches = /min-width/i.test(query);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

if (typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

afterEach(() => {
  cleanup();
});

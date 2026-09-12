import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // A suite roda no fuso da operacao. Em UTC (o fuso do CI) um `new Date()`
    // sobre data de calendario nao desloca o dia, e o bug "ETD 06/08 com a
    // invoice dizendo 07/08" passava verde. Ver shared/lib/utils.ts.
    env: { TZ: 'America/Sao_Paulo' },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/vite-env.d.ts', 'src/app/index.css'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

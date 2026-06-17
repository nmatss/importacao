import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, '../..');
  const env = loadEnv(mode, envDir, '');
  const certApiKey = env.CERT_API_KEY?.trim();

  return {
    plugins: [react(), tailwindcss()],
    envDir,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-recharts': ['recharts'],
            'vendor-ui': ['lucide-react', 'sonner'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/cert-api': {
          target: 'http://localhost:8002',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cert-api/, ''),
          ...(certApiKey ? { headers: { 'X-API-Key': certApiKey } } : {}),
        },
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});

/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

export default defineConfig({
  // GitHub Pages serves from /<repo>/; set BASE_PATH=/scent-cone/ for that build
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

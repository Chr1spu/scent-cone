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
  build: {
    // three.js alone is ~680 kB minified (176 kB gzipped) and cannot be split further
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // vendor chunks: cached across deploys and fetched in parallel
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          react: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

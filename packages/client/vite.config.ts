import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true }, '/version': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: false },
});

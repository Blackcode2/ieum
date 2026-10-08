import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the same build works at a domain root and in a GitHub Pages subfolder.
  base: './',
  plugins: [react()],
  server: { host: 'localhost', port: 5173, strictPort: true },
});

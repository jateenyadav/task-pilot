import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The UI is loaded from disk by Electron (file://), so asset paths must be relative.
export default defineConfig({ base: './', plugins: [react(), tailwindcss()], server: { port: 5180, strictPort: true } });

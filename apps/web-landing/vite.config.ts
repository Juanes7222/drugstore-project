import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Backoffice owns 5173; the server's CORS allowlist is origin-based, so a
    // silent port bump breaks every checkout call.
    port: 5174,
    strictPort: true,
  },
});

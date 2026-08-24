import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fail loudly instead of drifting to another port: the server's CORS
    // allowlist is origin-based, so a silent port bump breaks every call.
    port: 5173,
    strictPort: true,
  },
});
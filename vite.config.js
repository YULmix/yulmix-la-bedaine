import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    // Preview-only tools (#105: "Se connecter comme…"). True on the dev server and in Vercel
    // Preview builds (vercel build sets VERCEL_ENV); false everywhere else, including when
    // VERCEL_ENV is missing, so production builds drop that code and its strings entirely.
    __PREVIEW_TOOLS__: JSON.stringify(command === 'serve' || process.env.VERCEL_ENV === 'preview')
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          lucide: ['lucide-react'],
          router: ['react-router-dom']
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
}));

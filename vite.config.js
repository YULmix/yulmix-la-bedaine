import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});
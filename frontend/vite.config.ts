import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// When running npm run dev locally (outside Docker), use localhost.
// When running inside Docker, set DJANGO_HOST / FASTAPI_HOST env vars.
const DJANGO  = process.env.DJANGO_HOST  ?? 'http://localhost:8000'
const FASTAPI = process.env.FASTAPI_HOST ?? 'http://localhost:8001'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@apps': path.resolve(__dirname, './src/apps'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@store': path.resolve(__dirname, './src/store'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@i18n': path.resolve(__dirname, './src/i18n'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['citybus.com.np', 'www.citybus.com.np', '.localhost'],
    proxy: {
      // FastAPI live routes MUST come before the generic /api catch-all
      '/api/v1/live': {
        target: FASTAPI,
        changeOrigin: true,
        ws: true,
      },
      '/public-api': {
        target: FASTAPI,
        changeOrigin: true,
      },
      // Django REST API (catch-all after more-specific rules above)
      '/api': {
        target: DJANGO,
        changeOrigin: true,
      },
      // Django Channels WebSocket
      '/ws': {
        target: DJANGO.replace('http', 'ws'),
        ws: true,
        changeOrigin: true,
      },
      // Django media files
      '/media': {
        target: DJANGO,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          maps: ['react-map-gl', 'maplibre-gl'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})

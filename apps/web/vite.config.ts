import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'push-sw.js'],
      manifest: {
        name: 'IGV EXPERIENCE',
        short_name: 'IGV',
        description: 'Tu vida real, medida y con progreso.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0e16',
        theme_color: '#0a0e16',
        // Accesos directos al mantener presionado el ícono de la app.
        shortcuts: [
          { name: 'Registrar misión', short_name: 'Misión', url: '/?accion=mision', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Registrar gasto', short_name: 'Gasto', url: '/?accion=gasto', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Registrar ingreso', short_name: 'Ingreso', url: '/?accion=ingreso', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Planear', short_name: 'Agenda', url: '/?accion=plan', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // La API nunca se cachea en el service worker: los datos viven en IndexedDB y se sincronizan.
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Manejo de notificaciones push (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});

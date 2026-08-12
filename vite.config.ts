import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Geliştirme arayüzünü Cloudflare Quick Tunnel üzerinden test etmeye izin verir.
    // SQL API dışarı açılmaz; /api istekleri yerelde backend'e aktarılır.
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      // Frontend dışı çalışma klasörleri ve tarayıcı test profilleri sık sık
      // değişir. Bunları izlemek Tailwind HMR üzerinden gereksiz tam sayfa
      // yenilemelerine neden olur.
      ignored: [
        '**/.account-work/**',
        '**/.artifact-work/**',
        '**/.codex-tmp/**',
        '**/backend/**',
        '**/dist/**',
        '**/imza/**',
        '**/sql/**'
      ]
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        headers: {
          Origin: 'http://localhost:5173',
        },
      },
      '/exports': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Yeni sürüm geldiğinde kullanıcıya mevcut uygulama içi uyarıyı göster.
      // Otomatik etkinleştirme sayfayı çalışma sırasında kendiliğinden yeniliyordu.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'logo.png', 'huseyin-mode.jpg'],
      manifest: {
        short_name: 'İSTEK Demirbaş Yönetimi',
        name: 'İSTEK IT Demirbaş Yönetimi',
        description: 'Bilgi İşlem Envanter ve Zimmet Takip Sistemi',
        theme_color: '#0066b1',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      }
    })
  ],
});

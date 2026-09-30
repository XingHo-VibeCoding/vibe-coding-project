import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5180,
  },
  // 线上发布用 vite preview serve dist，需放行反向代理域名
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})

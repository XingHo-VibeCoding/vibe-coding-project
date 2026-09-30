import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

/* 版本号单一来源：package.json 的 version。
   界面「关于」页显示的串由这里注入，App 打包脚本（app/scripts/patch-android.js）
   也读同一个文件 —— 所以升版本只改 package.json 一处，界面上写死的 vX.Y 已经删掉了。
   显示口径沿用历史：1.28.0 → “v1.28”（去掉 patch 位）。 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const [verMaj, verMin] = String(pkg.version).split('.')
const APP_VERSION = `v${verMaj}.${verMin}`

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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

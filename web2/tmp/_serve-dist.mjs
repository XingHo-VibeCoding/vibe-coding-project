/* 临时：把 dist 当静态站跑起来（给依赖外部服务的旧探针用）。用法：node tmp/_serve-dist.mjs 4177 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
const ROOT = path.resolve('dist')
const PORT = Number(process.argv[2] || 4177)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0])
    const file = path.join(ROOT, p === '/' ? 'index.html' : p)
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    try { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(path.join(ROOT, 'index.html'))) }
    catch { res.writeHead(404); res.end('404') }
  }
}).listen(PORT, '127.0.0.1', () => console.log('serving dist on ' + PORT))

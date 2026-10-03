import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { readFileSync } from 'node:fs'
const BASE = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 640 } })
const page = await ctx.newPage()
await page.addInitScript('localStorage.setItem("web2.onboarded","1");localStorage.setItem("web2.data",' + JSON.stringify(readFileSync('D:/Document/Project/vibe-coding-project/web2/tmp/valid-export.json', 'utf8')) + ');')
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
const info = await page.evaluate(() => ({
  date: new Date().toISOString(),
  header: (document.querySelector('[data-header-status]') || {}).innerText,
  strip: (document.querySelector('[data-today-strip]') || {}).innerText,
  todayItems: document.querySelectorAll('[data-today-item]').length,
  next: (document.querySelector('[data-today-next]') || {}).innerText,
  habitMore: document.querySelectorAll('[data-today-habit-more]').length,
  todayText: (document.querySelector('[data-page="today"]') || {}).innerText?.slice(0, 400),
  raw: (localStorage.getItem('web2.data') || '').slice(0, 300),
}))
console.log(JSON.stringify(info, null, 2))
await browser.close()

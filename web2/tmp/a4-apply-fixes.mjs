/* A4 修复批次 2–4 的代码改写器。
   只做字面量替换，逐行打印改动，默认 dry-run（--apply 才落盘）。
   行尾保留：按 '\n' 切分/拼接，行内的 '\r' 原样带着走，不会把 CRLF 改成 LF。 */
import { readFileSync, writeFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const FILES = [
  'src/App.vue',
  'src/components/TimeWheel.vue',
  'src/components/NumberWheel.vue',
  'src/components/DropdownSelect.vue',
  'src/style.css',
]

const RULES = [
  {
    name: '批次2 ink-dim 去 alpha（/90 /80 /70 /60 /50 → 实色）',
    run: (l) => l.replace(/text-ink-dim\/(90|80|70|60|50)\b/g, 'text-ink-dim'),
  },
  {
    name: '批次2 输入框 placeholder 去 alpha',
    run: (l) => l.replace(/placeholder:text-ink-dim\/40\b/g, 'placeholder:text-ink-dim'),
  },
  {
    name: '批次3 主色当文字：暗色下 primary-500(3.69) → primary-600(两主题都达标)',
    run: (l) => {
      if (!l.includes('text-primary-500')) return l
      if (l.includes('<svg') || l.includes('bg-primary-500')) return l // 图标(3:1 达标)与底色不动
      return l.replace(/text-primary-500\/70\b/g, 'text-primary-600').replace(/text-primary-500\b/g, 'text-primary-600')
    },
  },
  {
    name: '批次4 浅色 red 文字加深（暗色保留 400）',
    run: (l) => {
      if (l.includes('dark:text-red-')) return l // 已改过，保幂等
      return l.replace(/text-red-(400|500)\b/g, 'text-red-600 dark:text-red-400')
    },
  },
  {
    name: '批次4 浅色 amber 文字加深（暗色保留原档）',
    run: (l) => {
      if (l.includes('dark:text-amber-')) return l
      return l.replace(/text-amber-500\b/g, 'text-amber-700 dark:text-amber-500').replace(/text-amber-600\b/g, 'text-amber-700 dark:text-amber-600')
    },
  },
]

const OUT = []
const say = (s) => { OUT.push(s); console.log(s) }

let total = 0
for (const f of FILES) {
  const raw = readFileSync(f, 'utf8')
  const lines = raw.split('\n')
  const changed = []
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i]
    for (const r of RULES) {
      const next = r.run(cur)
      if (next !== cur) {
        changed.push({ n: i + 1, rule: r.name, before: cur.trim(), after: next.trim() })
        cur = next
      }
    }
    lines[i] = cur
  }
  if (!changed.length) continue
  say(`\n===== ${f}：${changed.length} 行 =====`)
  for (const c of changed) say(`  ${c.n}  [${c.rule.slice(0, 6)}]\n      - ${c.before.slice(0, 150)}\n      + ${c.after.slice(0, 150)}`)
  total += changed.length
  if (APPLY) writeFileSync(f, lines.join('\n'), 'utf8')
}
say(`\n合计改动 ${total} 行（${APPLY ? '已写入' : 'dry-run，未写入；加 --apply 落盘'}）`)
writeFileSync('tmp/a4-fixes-dryrun.txt', OUT.join('\n') + '\n', 'utf8')

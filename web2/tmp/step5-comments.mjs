/* 方案 C · Step 5 附带：清掉改版留下的「僵尸注释」（描述已被删掉的页面）并补回去掉的一句设计理由。
   跑法：cd web2 && node tmp/step5-comments.mjs
   锚点用单行（文件是 CRLF，多行锚点会失配）。 */
import { readFileSync, writeFileSync } from 'node:fs'

const APP = 'D:/Document/Project/vibe-coding-project/web2/src/App.vue'
let src = readFileSync(APP, 'utf8')
const before = src
const log = []

function sub(name, from, to, expect) {
  const n = src.split(from).length - 1
  if (n !== expect) throw new Error(`锚点异常：${name} 期望 ${expect} 处，实际 ${n} 处 —— 未写盘`)
  src = src.split(from).join(to)
  log.push(`${name} ×${n}`)
}

// 1) 平移层注释：四页并排各占 1/4 → 三页各占 1/3（Step 1 改成 3 个 tab 后没跟着改）
sub('平移层注释「四页并排各占 1/4」→「三页并排各占 1/3」',
  '内容平移层（Day 11 二轮）：四页并排各占 1/4，translateX 跟随 tab，连点改道可打断。',
  '内容平移层（Day 11 二轮）：三页并排各占 1/3，translateX 跟随 tab，连点改道可打断。', 1)

// 2) 删掉两段僵尸注释（原「日程清单页」与「打卡页」，页面本身在 Step 1 已并入课表页 / 打卡浮层；
//    打卡的口径说明在脚本区 :501 已有一份，这里只剩重复）
//    按行号切除，避免猜空白（这批注释之间空行/行尾空格都不规则）
{
  const lines = src.split('\r\n')
  const startAt = lines.findIndex((l) => l.includes('<!-- ===== 日程清单页（三期「日程分类视图」'))
  const endAt = lines.findIndex((l) => l.includes('改由 onHabitCell 静默忽略。 -->'))
  if (startAt < 0 || endAt < 0 || endAt < startAt) throw new Error(`锚点异常：僵尸注释区间未找到（${startAt}..${endAt}）—— 未写盘`)
  let cutTo = endAt // 连同后面全空白行一起吃掉
  while (cutTo + 1 < lines.length && lines[cutTo + 1].trim() === '') cutTo++
  const removed = lines.splice(startAt, cutTo - startAt + 1)
  log.push(`删除僵尸注释 ${startAt + 1}-${cutTo + 1} 行（${removed.length} 行，日程清单页 + 打卡页）`)
  src = lines.join('\r\n')
}

// 3) 僵尸注释里那句「不用 disabled」的理由是孤本，搬到打卡浮层注释里
sub('打卡浮层注释补回「不用 disabled」的设计理由',
  '    <!-- 打卡浮层（2026-10-03 方案 C Step 1：原「打卡」tab 改为底部浮层） -->',
  [
    '    <!-- 打卡浮层（2026-10-03 方案 C Step 1：原「打卡」tab 改为底部浮层）',
    '         宽限期 = 本周内且今天之前（口径见 data/store.js）；过期/未来格子画成锁定态，',
    '         但**不用 disabled**（那样点下去毫无反馈还挡测试），改由 onHabitCell 静默忽略。 -->',
  ].join('\r\n'), 1)

writeFileSync(APP, src, 'utf8')
console.log(log.join('\n'))
console.log(`\nApp.vue: ${before.length} → ${src.length} 字符（${src.length - before.length}）`)

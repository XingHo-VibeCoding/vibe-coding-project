/* data/keyboard.js —— 软键盘让位（Day 32，2026-10-16 修）

   为什么要有这个文件：App 里几乎所有输入框都住在「贴底固定」的容器里 ——
   BottomSheet 的面板是 fixed bottom-0、二级页/引导页是 fixed inset-0。
   而壳仓 targetSdkVersion=35（Android 15 强制边到边）之后，键盘弹出时窗口
   **不再自动变矮**（Manifest 里也从没写过 windowSoftInputMode），于是键盘直接
   盖在网页上，浮层底部整块被挡住 —— 用户 2026-10-16 实测：填日程的时间、地点、
   备注时，底部的输入框看不见，所有需要打字的地方都一样。

   做法：量出键盘占地，写成一个 CSS 变量 --kb，交给 CSS 让位：
     · 贴底浮层：bottom: var(--kb)、max-height 收掉 var(--kb)
     · 整屏页（二级页 / 引导页 / 教预览）：padding-bottom: var(--kb)
   容器变矮之后，它内部的滚动区自然停在键盘上方，浏览器也会把聚焦的输入框滚进来。

   只在**有输入框聚焦**时才认这个差值：浏览器地址栏收起、横向旋转之类的视口抖动
   不该让浮层跳一下。没有 visualViewport 的老 WebView 照样装（只是没有 vv 监听），因为这时唯一的信息来源就是原生推过来的键盘高度。

   注意：网页侧单独做不到「让窗口真的变矮」——那是 Manifest 的 adjustResize 负责的
   （壳仓 scripts/patch-android.js）；这里只负责量出来 + 让位，并且不与窗口缩放叠加。

    Day 32 第二步（壳仓同步改）后的两层配合：
      主路径 — Manifest 里 MainActivity 写了 windowSoftInputMode=adjustResize，键盘弹出时
              窗口真的变矮，WebView 跟着缩，下面的 measure() 自然量到差值；
      兜底   — 某些 ROM 在边到边下仍不缩：原生 KeyboardInsetsPlugin 把 IME 高度推过来
              （shell.js 转成 window 事件 'wb-kb-native'），这里在「窗口没缩」时才采用。
    为什么必须二选一：窗口已经缩了 300px，再叠一个 --kb=300px，浮层会被顶高两次。
    判断「窗口缩没缩」= 当前 innerHeight 比见过的最高值矮 40px 以上（见 measure）。 */

const MIN_KB = 60 // 小于这个差值当抖动（地址栏收缩约 40~56px；软键盘通常 240~360px）

let installed = false
let rafId = 0
let lastKb = -1
let nativeKb = 0 // 原生报来的键盘高度（CSS px），只在窗口没跟着变矮时才用
let baseH = 0 // 见过的最高的 innerHeight：用来判断「窗口是不是被键盘压矮了」

/* 原生侧（壳仓 KeyboardInsetsPlugin → shell.js）推来的键盘高度。
   事件只为「提醒重算」，值存在 nativeKb 里。 */
function onNativeKb(e) {
  const h = e && e.detail ? Number(e.detail.height) : 0
  nativeKb = h > 0 && isFinite(h) ? Math.round(h) : 0
  schedule()
}

function isEditable(el) {
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/* 键盘占地 = 布局视口高 − 可视区高 − 可视区上偏移。
   没聚焦输入框时一律算 0（见文件头「只在有输入框聚焦时才认」）。 */
function measure() {
  if (!isEditable(document.activeElement)) return 0
  const vv = window.visualViewport
  const web = vv ? Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)) : 0
  if (web > MIN_KB) return web
  /* 窗口自己被压矮了（adjustResize 生效）→ 让位已由布局完成，再写 --kb 就是双重让位 */
  if (baseH && window.innerHeight < baseH - 40) return 0
  return nativeKb > MIN_KB ? nativeKb : 0
}

function apply() {
  const kb = measure()
  if (kb === lastKb) return
  lastKb = kb
  const root = document.documentElement
  if (kb > 0) root.style.setProperty('--kb', kb + 'px')
  else root.style.removeProperty('--kb')
  if (kb > 0) requestAnimationFrame(() => keepVisible(document.activeElement))
}

function schedule() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    /* 记下最高的视口高度：键盘把窗口压矮之后 innerHeight 会明显小于它。
       旋转/分屏也会改 innerHeight，但那种情况 visualViewport 自己说得清，走不到兜底这一支。 */
    if (window.innerHeight > baseH) baseH = window.innerHeight
    apply()
  })
}

/* 把聚焦的输入框挪进可视区。容器刚被压矮时输入框可能正好落在键盘后面，
   而浏览器自己只在「元素位置变了」时才自动滚，这里补一次。
   block: 'center' —— 让它落在可视区中间，而不是贴着键盘上沿那一线（实测 nearest 会
   把二级页的输入框顶到边界，只露半截）。 */
function keepVisible(el) {
  if (!isEditable(el) || document.activeElement !== el) return
  if (measure() <= 0) return
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
  } catch (e) {
    /* 老 WebView 不认对象参数：退回无参版本（浏览器兜底滚到可见） */
    el.scrollIntoView()
  }
}

function onFocusIn(e) {
  if (!isEditable(e.target)) return
  schedule()
  /* 键盘是异步弹起的：等它落定再量一次并把输入框滚进来 */
  setTimeout(() => keepVisible(e.target), 320)
}

function onFocusOut() {
  schedule()
}

/* 装上监听，返回卸载函数。只装一次；重复调用返回同一个卸载函数。 */
export function installKeyboardInset() {
  if (installed) return uninstallKeyboardInset
  baseH = window.innerHeight
  window.addEventListener('wb-kb-native', onNativeKb)
  const vv = window.visualViewport
  /* 没有 visualViewport 也要装：原生那条路（adjustResize / KeyboardInsetsPlugin）照样有用 */
  if (!vv) { installed = true; return uninstallKeyboardInset }
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  installed = true
  return uninstallKeyboardInset
}

export function uninstallKeyboardInset() {
  if (!installed) return
  const vv = window.visualViewport
  if (vv) {
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
  }
  window.removeEventListener('wb-kb-native', onNativeKb)
  window.removeEventListener('resize', schedule)
  window.removeEventListener('orientationchange', schedule)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  document.documentElement.style.removeProperty('--kb')
  installed = false
  lastKb = -1
  nativeKb = 0
  baseH = 0
}

/* 只给测试/排查用：读当前算出的键盘高度（网页探针断言 --kb 之外的第二重证据） */
export function keyboardInset() {
  return lastKb > 0 ? lastKb : 0
}

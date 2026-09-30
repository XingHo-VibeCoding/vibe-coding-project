/* 滚轮手势物理（纯函数，便于单测与调参）——2026-09-30

   背景：滚轮列原本把滚动交给浏览器原生处理（scroll-snap-type: y mandatory + 原生惯性）。
   实测暴露两个问题（tmp/wheel-feel-measure.mjs）：
   ① 跟着手指的跟手度在慢速档只有 0.56~0.80——mandatory 吸附在拖动过程中反复回吸，
      「手指走了 72px，内容只挪了 40px」，用户感受就是「慢慢滑动有点拖沓」；
   ② 列表循环化（三倍份、没有顶/底）之后，原生惯性没有边界兜底，一次快甩能跑很远，
      用户感受就是「快速滑动滚得太快」。

   解法与「组件手感三定律」第一条同源：触屏也自接管——拖动 1:1 直写 scrollTop（不吸附），
   松手按速度换算「滑几格」（有上限）再走一段短缓动吸附。
   这里放的全是纯函数，方便 node 直接单测，也方便日后调参只改常量。
*/

/* 2026-09-30 第五轮（用户反馈「快速滑动屏幕后滚动还是不够丝滑，现在一次约 13 个数，
   希望惯性大一点、能到 30 个数」）——上一轮把「跟手」和「时长连续」修好之后，
   这一轮只调「滑多远」，但**必须连时长上限和循环份数一起调**，否则会复发两个老毛病：
     ① 时长被 0.5s 上限压住 → 首帧速度突变 → 第四轮刚修好的顿挫复活（见下方 FLING_T_MAX 注释）；
     ② 循环列三份不够长 → 位移撞到底部被浏览器夹住 → 动画中途卡死（见 TimeWheel 的 REPEAT 注释）。 */
export const FLING_MIN_V = 150 // px/s：低于此速度视为「轻放」，不甩，只吸附到最近一格
export const FLING_V_PER_STEP = 100 // px/s：速度每多这么多，多滑 1 格（第五轮：320 → 100，灵敏度 ×3.2）
export const FLING_MAX_STEPS = 30 // 一次快甩最多滑几格（第五轮：8 → 30）
export const VELOCITY_WINDOW = 90 // ms：只用最近这段时间的采样估速度（用全部历史会低估）

/* 甩动时长必须由「松手速度」反推，这样动画首帧速度 = 手指末速，松手处才不会有速度突变。
   2026-09-30 第四轮（用户反馈「高速滑动不够丝滑」）：
   旧实现是固定时长（150 + 格数×26ms），快甩时动画首速只有约 2700px/s，而手指末速常有 4000px/s+
   → 松手瞬间内容「先慢半拍再急停」，这就是顿挫感。
   easeOutCubic 的首帧速度增益恒为 3（= 3×平均速度），所以：
       时长 = 位移 × 3 ÷ 松手速度
   真机实测（tmp/diag-v127.mjs）：修前 拖动末速 1320px/s → 动画首帧 1967px/s（+49%，窜一下）；
   修后两者基本相等 = 速度连续 = 丝滑。 */
export const FLING_T_MIN = 0.18 // s：时长下限，极快甩动时不至于「闪一下就到位」
/* 第五轮：0.5 → 1.6s。**这条必须跟 FLING_V_PER_STEP 一起改**，理由是一个恒等式：
     位移 d ≈ 格数 × ROW = (速度 ÷ perStep) × ROW
     时长 T = d × 3 ÷ 速度 = 3 × ROW ÷ perStep = 120 ÷ perStep（与甩多快无关！）
   perStep=320 → T≈0.375s（旧上限 0.5s 够用）；perStep=100 → T≈1.2s，
   若上限仍是 0.5s 就会被硬压短一半，首帧速度 = 3×d/T 直接翻 2.4 倍 = 松手「窜一下」。
   取 1.6s（≈0.5 × 3.2）留出余量：最慢的那档（v=150，滑 2 格 / 80px）T=1.6s 也刚好不被压。
   「时长与甩动速度无关」不是 bug 而是物理正确：真实惯性衰减时间由摩擦决定，与初速无关。 */
export const FLING_T_MAX = 1.6 // s：时长上限，很慢的甩动也不磨蹭
export const EASE_HEAD_GAIN = 3 // easeOutCubic 的首帧速度增益

/* 按「位移 + 松手速度」算动画时长（秒）。速度匹配见上方注释。 */
export function flingDuration(dist, v, opts = {}) {
  const a = Math.abs(Number(v) || 0)
  const d = Math.abs(Number(dist) || 0)
  const min = opts.min ?? FLING_T_MIN
  const max = opts.max ?? FLING_T_MAX
  if (!a || !d) return min
  const t = (d * (opts.gain ?? EASE_HEAD_GAIN)) / a
  return Math.min(max, Math.max(min, t))
}

/* 松手速度 → 滑几格（非负；方向由调用方按速度正负决定）。 */
export function flingSteps(v, opts = {}) {
  const minV = opts.minV ?? FLING_MIN_V
  const perStep = opts.perStep ?? FLING_V_PER_STEP
  const maxSteps = opts.maxSteps ?? FLING_MAX_STEPS
  const a = Math.abs(Number(v) || 0)
  if (a < minV) return 0
  return Math.min(maxSteps, Math.max(1, Math.round(a / perStep)))
}

/* 从触摸采样估速度。samples: [{t, y}] 时间递增，y 为 clientY。
   手指上移 → y 变小 → 返回正数（内容往后面的格走）。 */
export function velocityFromSamples(samples, windowMs = VELOCITY_WINDOW) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  // 至少用最后两个样本（否则「刚抬手只有两帧采样」会被窗口判成 0 速度，白丢一次甩动）
  let first = samples[samples.length - 2]
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t <= windowMs) first = samples[i]
    else break
  }
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return ((first.y - last.y) / dt) * 1000
}

/* 把 scrollTop 平移整数个「一份」，落进 [span, 2*span)。
   三份内容完全重复、对 ROW 相位相同 → 平移后视觉一模一样，这就是「无缝循环」。 */
export function normalizeTop(top, span) {
  if (!span) return top
  return top - Math.floor(top / span) * span + span
}

export function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3)
}

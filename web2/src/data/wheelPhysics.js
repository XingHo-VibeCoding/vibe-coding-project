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

export const FLING_MIN_V = 150 // px/s：低于此速度视为「轻放」，不甩，只吸附到最近一格
export const FLING_V_PER_STEP = 320 // px/s：速度每多这么多，多滑 1 格
export const FLING_MAX_STEPS = 8 // 一次快甩最多滑几格（上限就是「可控」本身）
export const VELOCITY_WINDOW = 90 // ms：只用最近这段时间的采样估速度（用全部历史会低估）

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

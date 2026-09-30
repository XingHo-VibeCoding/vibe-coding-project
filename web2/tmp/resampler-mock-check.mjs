/* StreamResampler 算法对拍（v1.14 原生重写的前置验证）：
   用 JS 逐行复刻 TranscriberPlugin.kt 的 StreamResampler，验证三件事——
   1. 分块喂入（随机块大小，含 1 帧/0 帧极端）与整段一次性重采样输出完全一致
   2. 频率保真：440Hz 正弦重采样后主频仍是 440Hz（过零率校验）
   3. 双声道均值混缩正确
   全过才动 gradle，避免真机才发现算法错。 */

import { strict as assert } from 'node:assert'

const TARGET_RATE = 16000

class StreamResampler {
  constructor(srcRate, channels) {
    this.ratio = srcRate / TARGET_RATE
    this.channels = channels
    this.framesSeen = 0
    this.prevMono = 0.0
    this.prev2Mono = 0.0
    this.framesOut = 0
  }
  process(sb, emit) {
    const n = Math.floor(sb.length / this.channels)
    if (n === 0) return
    const end = this.framesSeen + n
    while (this.framesOut * this.ratio < end - 1) {
      const pos = this.framesOut * this.ratio
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const m0 = this.monoAt(sb, i0, this.framesSeen)
      const m1 = this.monoAt(sb, i0 + 1, this.framesSeen)
      emit((m0 * (1 - frac) + m1 * frac) / 32768.0)
      this.framesOut++
    }
    this.prev2Mono = n >= 2 ? this.monoAt(sb, end - 2, this.framesSeen) : this.prevMono
    this.prevMono = this.monoAt(sb, end - 1, this.framesSeen)
    this.framesSeen = end
  }
  flush(emit) {
    while (this.framesOut * this.ratio <= this.framesSeen - 1) {
      const pos = this.framesOut * this.ratio
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const m0 = i0 === this.framesSeen - 2 ? this.prev2Mono : this.prevMono
      emit((m0 * (1 - frac) + this.prevMono * frac) / 32768.0)
      this.framesOut++
    }
  }
  monoAt(sb, absIdx, blockStart) {
    if (absIdx === blockStart - 1) return this.prevMono
    const base = (absIdx - blockStart) * this.channels
    let s = 0
    for (let c = 0; c < this.channels; c++) s += sb[base + c]
    return s / this.channels
  }
}

/* 整段一次性重采样（参照实现，等价旧代码 to16kMonoFloat） */
function wholeResample(bytes, srcRate, channels) {
  const frames = Math.floor(bytes.length / 2 / channels)
  if (frames === 0) return []
  const sb = new Array(Math.floor(bytes.length / 2))
  for (let i = 0; i < sb.length; i++) sb[i] = bytes.readInt16LE(i * 2)
  const outFrames = Math.floor(frames * TARGET_RATE / srcRate)
  const out = new Array(outFrames)
  const ratio = srcRate / TARGET_RATE
  const monoAt = (f) => {
    let s = 0
    const base = f * channels
    for (let c = 0; c < channels; c++) s += sb[base + c]
    return s / channels
  }
  for (let j = 0; j < outFrames; j++) {
    const pos = j * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, frames - 1)
    const frac = pos - i0
    out[j] = (monoAt(i0) * (1 - frac) + monoAt(i1) * frac) / 32768.0
  }
  return out
}

/* 合成源：1 分钟 44.1k 双声道 = 440Hz + 880Hz 叠加（浮点 pcm[i]∈[-1,1]）→ s16交错 */
const SRC_RATE = 44100
const CH = 2
const DUR_S = 60
const frames = SRC_RATE * DUR_S
const interleaved = Buffer.alloc(frames * CH * 2)
for (let f = 0; f < frames; f++) {
  const t = f / SRC_RATE
  const v = 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t)
  const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  interleaved.writeInt16LE(s, f * CH * 2)
  interleaved.writeInt16LE(s, f * CH * 2 + 2) // 右声道同值（mono 混缩不受影响）
}

let pass = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ✓', name) } else { console.log('  ✗ FAIL', name); process.exitCode = 1 }
}

/* 1. 分块 vs 整段：随机块大小喂入（含 0 帧、1 帧极端块），输出须逐位一致 */
{
  const ref = wholeResample(interleaved, SRC_RATE, CH)
  for (let trial = 0; trial < 5; trial++) {
    const rs = new StreamResampler(SRC_RATE, CH)
    const out = []
    let off = 0
    while (off < interleaved.length) {
      // 随机块大小（字节），偶数对齐；偶尔塞一块全空
      let size = 2 * CH * (1 + Math.floor(Math.random() * 9000))
      if (Math.random() < 0.05) size = 2 * CH // 最小 1 帧
      const block = interleaved.subarray(off, Math.min(off + size, interleaved.length))
      off += block.length
      const shorts = []
      for (let i = 0; i < block.length / 2; i++) shorts.push(block.readInt16LE(i * 2))
      rs.process(shorts, (f) => out.push(f))
      if (Math.random() < 0.1) rs.process([], () => {}) // 0 帧块
    }
    rs.flush((f) => out.push(f))
    let same = out.length === ref.length
    if (same) for (let i = 0; i < out.length; i++) if (out[i] !== ref[i]) { same = false; break }
    t(`trial${trial + 1} 分块喂入与整段输出完全一致（${out.length} 样本）`, same)
  }
  t('输出帧数 = frames*16k/44.1k（±1）', Math.abs(ref.length - frames * TARGET_RATE / SRC_RATE) <= 1)
}

/* 2. 频率保真：纯 440Hz 正弦重采样后主频不变（过零率估计；不用叠加谐波——
   叠加二次谐波时波形每周期可能多次过零，过零率失效，是测试设计错误不是实现错误） */
{
  const framesS = SRC_RATE * 5 // 5 秒纯音
  const pure = Buffer.alloc(framesS * CH * 2)
  for (let f = 0; f < framesS; f++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * f / SRC_RATE) * 20000)
    pure.writeInt16LE(v, f * CH * 2)
    pure.writeInt16LE(v, f * CH * 2 + 2)
  }
  const ref = wholeResample(pure, SRC_RATE, CH)
  let zc = 0
  for (let i = 1; i < ref.length; i++) if (ref[i - 1] < 0 && ref[i] >= 0) zc++
  const estFreq = zc * TARGET_RATE / ref.length // 每秒向上过零次数=频率
  t(`440Hz 过零率估计 ≈ ${estFreq.toFixed(1)}Hz（±2Hz）`, Math.abs(estFreq - 440) < 2)
}

/* 3. 双声道不同值：mono 均值混缩 */
{
  const frames2 = 3000
  const buf = Buffer.alloc(frames2 * 2 * 2)
  for (let f = 0; f < frames2; f++) {
    buf.writeInt16LE(1000, f * 4)
    buf.writeInt16LE(3000, f * 4 + 2)
  }
  const ref = wholeResample(buf, 32000, 2)
  const rs = new StreamResampler(32000, 2)
  const out = []
  const shorts = []
  for (let i = 0; i < buf.length / 2; i++) shorts.push(buf.readInt16LE(i * 2))
  rs.process(shorts, (f) => out.push(f))
  rs.flush((f) => out.push(f))
  t('双声道均值混缩 = (1000+3000)/2/32768', Math.abs(out[10] - 2000 / 32768) < 1e-6 && Math.abs(ref[10] - out[10]) < 1e-12)
}

/* 4. 高采样率比（48k→16k，ratio=3）分块一致性 */
{
  const frames3 = 48000 // 1 秒
  const buf = Buffer.alloc(frames3 * 2)
  for (let f = 0; f < frames3; f++) {
    const v = Math.sin(2 * Math.PI * 220 * f / 48000) * 20000
    buf.writeInt16LE(Math.round(v), f * 2)
  }
  const ref = wholeResample(buf, 48000, 1)
  const rs = new StreamResampler(48000, 1)
  const out = []
  for (let off = 0; off < buf.length; off += 2 * 7) { // 7 帧一块，故意非整除
    const block = buf.subarray(off, Math.min(off + 2 * 7, buf.length))
    const shorts = []
    for (let i = 0; i < block.length / 2; i++) shorts.push(block.readInt16LE(i * 2))
    rs.process(shorts, (f) => out.push(f))
  }
  rs.flush((f) => out.push(f))
  let same = out.length === ref.length
  if (same) for (let i = 0; i < out.length; i++) if (out[i] !== ref[i]) { same = false; break }
  t('48k→16k（ratio=3）7 帧分块一致', same)
}

console.log(`\n${pass} 条全过` )

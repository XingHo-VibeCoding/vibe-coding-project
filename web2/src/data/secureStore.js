/* web2 机密存取出口（P12b 后续，2026-10-08）——单一口径：**密码绝不写进 localStorage**。
 *
 * 分工（与 eduLogin.js 的「账号存档」一节配合）：
 *      eduLogin.js   只存「非机密」的账号信息（学号、记住开关、上次选的学年/学期）
 *      secureStore.js 存「机密」（教务密码）——App 里进 Android 系统密钥库，别处没有退路可言
 *
 * 平台判定看 `window.Capacitor.Plugins.SecureStore` 是否存在（与 recorder.js / listenStore.js 一个范式，
 * 便于测试注入假插件）。三种环境的行为：
 *   · App（插件在）      → 走密钥库，AES-GCM 密文落盘，私钥永不出系统
 *   · 浏览器（无插件）    → 如实返回 unsupported，由调用方决定要不要退回 localStorage（见 eduLogin.js）
 *   · 插件在但调用失败    → 抛出的错误如实上抛，**绝不静默吞掉**（吞掉的后果是用户以为密码记住了）
 *
 * 本文件不碰 localStorage、不碰 DOM。 */

const NOT_APP = '这个能力要在 App 里用（当前环境没有系统密钥库）。'

function plugin() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  const p = c && c.Plugins ? c.Plugins : null
  const ss = p ? p.SecureStore : null
  return ss && typeof ss.get === 'function' && typeof ss.set === 'function' ? ss : null
}

/* 当前环境能不能用系统密钥库（浏览器/桌面为 false，App 为 true） */
export function secureStoreAvailable() {
  return !!plugin()
}

/* 读。返回 { ok, value, missing, error }
     ok + value      —— 读到了
     ok + missing    —— 从来没存过（**不是错误**）
     !ok             —— 存过但解不开，或插件报错；error 是原话 */
export async function secretGet(key) {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, error: NOT_APP }
  try {
    const r = await p.get({ key })
    const v = r && r.value
    if (v == null || v === '') return { ok: true, missing: true, value: '' }
    return { ok: true, value: String(v) }
  } catch (e) {
    return { ok: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

/* 写。返回 { ok } 或 { ok:false, unsupported?, error } */
export async function secretSet(key, value) {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, error: NOT_APP }
  try {
    await p.set({ key, value: String(value == null ? '' : value) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

/* 删。返回 { ok } 或 { ok:false, unsupported?, error }。删不存在的项也算成功。 */
export async function secretRemove(key) {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, error: NOT_APP }
  try {
    await p.remove({ key })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

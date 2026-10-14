<script setup>
import { ref, computed, onMounted } from 'vue'
import { toRefs } from 'vue'
import { useApp } from '../../../composables/app-ctx.js'
/* P7 云同步：这个二级页是唯一用户入口，所以直接 import 数据层（同 EventSheet 接 eventParser 的写法），
   不往 APP_CTX 里搬函数 —— 云端同步不是别的页面要用的东西，摆进 800 多项的名单只会更乱。 */
import {
  loadSyncConfig,
  saveSyncConfig,
  resetSyncRev,
  localDocSummary,
  syncUpload,
  syncDownload,
  syncClearCloud,
  SYNC_MIN_PASS,
} from '../../../data/sync.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  source,
  importMsg,
  onImportFile,
  onEduFile,
  openEduLogin,
  eduMsg,
  eduMsgBad,
  eduSnapshot,
  onRestoreEduSnapshot,
  onExportBack,
  onExportIcs,
  reloadDataset,
} = toRefs(app)

/* ---------------- P7 云同步（2026-10-12，用户 m07603 拍板） ----------------
   口径：同步串只存本机（web2.sync），服务端拿 HMAC(WRITE_TOKEN, 串) 当 owner_uid；
   两台设备输入同一个串 = 同一份数据。范围只有「课表 + 待办」六把键（见 sync.js 的 SYNC_KEYS），
   录音音频 / 每日快照 / 练耳进度这些本机大件不上云。 */
const syncCfg = ref(loadSyncConfig())
const syncPass = ref(syncCfg.value.pass)
const syncBusy = ref(false)
const syncMsg = ref('')
const syncMsgBad = ref(false)
const syncConflict = ref(null) // 上传撞到云端更新时摆出来的二选一面板
const syncConfirmClear = ref(false) // 清空云端要连点两次
const syncSummary = ref(localDocSummary())

/* 本机串够不够长（不够就不让按上传/下载，省一个来回） */
const syncPassOk = computed(() => syncPass.value.trim().length >= SYNC_MIN_PASS)
/* 本机到底有没有东西可传 —— 没有的话「上传」按下去只会得到一句错误 */
const syncHasData = computed(() => syncSummary.value.keys > 0)
const syncUidShort = computed(() => (syncCfg.value.uid ? syncCfg.value.uid.slice(0, 8) : ''))
const syncLastAt = computed(() => {
  const t = syncCfg.value.at
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

function syncRefresh() {
  syncCfg.value = loadSyncConfig()
  syncSummary.value = localDocSummary()
}

function syncRemember() {
  const p = syncPass.value.trim()
  syncPass.value = p
  syncConflict.value = null
  if (!p) {
    // 清空输入框 = 忘掉本机的串（不动云端那份）
    saveSyncConfig({ pass: '' })
    resetSyncRev()
    syncMsg.value = '已忘记本机保存的同步串（云端那份数据没动）。'
    syncMsgBad.value = false
  } else {
    /* 换了串就必须把 rev 归零：rev 是「本机是基于云端哪一版」，
       对着另一份数据算出来的 rev 毫无意义，留着会让冲突判断张冠李戴。 */
    const changed = p !== syncCfg.value.pass
    saveSyncConfig({ pass: p, ...(changed ? { rev: 0, at: '', uid: '' } : {}) })
    syncMsg.value = changed
      ? `同步串已保存（${p.length} 个字符）。换过串，上次同步记录已清空，下次上传会当成第一次。`
      : `同步串已保存（${p.length} 个字符）。`
    syncMsgBad.value = false
  }
  syncRefresh()
}

async function doSyncUpload(force = false) {
  if (syncBusy.value) return
  syncBusy.value = true
  syncMsg.value = force ? '正在用本机覆盖云端…' : '正在把本机数据传到云端…'
  syncMsgBad.value = false
  syncConflict.value = null
  try {
    const r = await syncUpload({ pass: syncPass.value, force })
    syncMsg.value = `已上传：${r.keys} 项（课表与待办），云端现在是最新一版（rev ${r.rev}）。`
  } catch (e) {
    if (e && e.status === 409) {
      syncConflict.value = { cloudRev: e.cloudRev, at: e.cloudUpdatedAt, message: e.message }
      syncMsg.value = '云端有一份更新的数据，先选一个再往下走。'
      syncMsgBad.value = true
    } else {
      syncMsg.value = (e && e.message) || '上传失败，本机数据没有动。'
      syncMsgBad.value = true
    }
  } finally {
    syncBusy.value = false
    syncRefresh()
  }
}

async function doSyncDownload() {
  if (syncBusy.value) return
  syncBusy.value = true
  syncMsg.value = '正在从云端取回数据…'
  syncMsgBad.value = false
  try {
    const r = await syncDownload({ pass: syncPass.value })
    if (!r.found) {
      syncMsg.value = '这个串在云端还没有数据：点「上传」就会把这台设备的课表和待办存上去。'
      syncMsgBad.value = false
    } else {
      reloadDataset.value() // 本机数据换了，页面上的课表/待办要跟着重读
      syncMsg.value = `已从云端取回：${r.applied} 项写进这台设备（rev ${r.rev}）。本机原有数据已被替换。`
      syncMsgBad.value = false
    }
    syncConflict.value = null
  } catch (e) {
    syncMsg.value = (e && e.message) || '下载失败，本机数据没有动。'
    syncMsgBad.value = true
  } finally {
    syncBusy.value = false
    syncRefresh()
  }
}

async function doSyncClearCloud() {
  if (syncBusy.value) return
  if (!syncConfirmClear.value) {
    // 第一次点只是上膛：云端删掉就没了，二次确认不能省
    syncConfirmClear.value = true
    syncMsg.value = '再点一次「清空云端」确认删除云端那份（本机数据不受影响）。'
    syncMsgBad.value = true
    armSyncClear()
    return
  }
  syncConfirmClear.value = false
  clearTimeout(syncClearTimer)
  syncBusy.value = true
  syncMsg.value = '正在清空云端…'
  try {
    const r = await syncClearCloud({ pass: syncPass.value })
    syncMsg.value = r.deleted ? '云端那份已删除，本机数据保留。' : '云端本来就没有这个串的数据，什么都没做。'
    syncMsgBad.value = false
  } catch (e) {
    syncMsg.value = (e && e.message) || '清空失败，没有改动任何数据。'
    syncMsgBad.value = true
  } finally {
    syncBusy.value = false
    syncRefresh()
  }
}

/* 清空上膛状态 4 秒后自动复位，避免用户走开后再回来一点就把云端删了 */
let syncClearTimer = null
function armSyncClear() {
  clearTimeout(syncClearTimer)
  syncClearTimer = setTimeout(() => {
    syncConfirmClear.value = false
  }, 4000)
}

onMounted(() => {
  syncPass.value = syncCfg.value.pass
  syncRefresh()
})
</script>

<template>
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 导入主项目数据 -->
        <label class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-soft">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M3 11v2.5A.5.5 0 003.5 14h9a.5.5 0 00.5-.5V11" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">导入主项目数据</span>
          <span class="text-xs" :class="source === 'import' ? 'text-primary-600' : 'text-ink-dim'">
            {{ source === 'import' ? '已导入 ✓' : '选择导出的 JSON' }}
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          <input type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />
        </label>

        <!-- P12a 从教务导出文件导入课表（2026-10-06）。
              与上面「导入主项目数据」是两条不同的路：那条换**整份数据**（含待办/日程），
              这条只换**课程**、且要先过一遍预览确认（见 App.vue 的 data-edu-preview）。
              放在「导入主项目数据」下面，因为它依赖已有一份主项目数据当底子。 -->
        <button
          data-edu-login-open
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-soft"
          @click="openEduLogin"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l5 2.2v4c0 3-2.1 5.4-5 6.3-2.9-.9-5-3.3-5-6.3v-4z" /><path d="M5.8 8l1.6 1.6L10.6 6" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">登录教务网抓课表</span>
            <span class="block text-[11px] text-ink-dim">填一次统一身份认证账号，直接抓课表</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <label class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-soft">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M2 6h12M6 6v8M10 6v8" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">从教务导入课表</span>
            <span class="block text-[11px] text-ink-dim">选教务导出的 .xlsx，先核对再替换（只换课程）</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" data-edu-file @change="onEduFile" />
        </label>

        <!-- 教务导入的回执（成功/失败都留在这行）。
              为什么还要在浮层外面再挂一次：解析**失败到抛异常**那条路上，浮层根本没打开
              （App 侧把它设回 null），而回执原来只写在浮层里面 ⇒ 用户点完文件**什么都看不到**。
              2026-10-06 就是被这个坑耽误了一轮排查：测试只知道「预览没出现」。 -->
        <p
          v-if="eduMsg"
          data-edu-msg-out
          class="px-4 pb-3 text-[11px]"
          :class="eduMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'"
        >{{ eduMsg }}</p>

        <!-- 恢复上一套课表：只在有教务导入留下的快照时出现（没有就不摆这个按钮） -->
        <button
          v-if="eduSnapshot"
          data-edu-restore
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-soft"
          @click="onRestoreEduSnapshot"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 109.8-3.4M2.5 2.5v3h3" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">恢复上一套课表</span>
            <span class="block text-[11px] text-ink-dim">
              换课表前自动存的（{{ eduSnapshot.courses }} 门课<template v-if="eduSnapshot.added">，含 {{ eduSnapshot.added }} 门手动加的</template>）
            </span>
          </span>
        </button>

        <!-- 导出回写主项目（仅导入态出现）：勾选过的待办随文件带走 -->
        <button
          v-if="source === 'import'"
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-soft"
          @click="onExportBack"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 13h10" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出回写主项目</span>
            <span class="block text-[11px] text-ink-dim">勾选过的待办会同步进导出文件</span>
          </span>
        </button>

        <!-- 导出日历 .ics：把课表装进系统日历 -->
        <button
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-soft"
          @click="onExportIcs"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出日历（.ics）</span>
            <span class="block text-[11px] text-ink-dim">整学期课表装进系统日历，带课前提醒</span>
          </span>
        </button>
      </section>

      <!-- ---------------- P7 云同步（2026-10-12，用户 m07603） ----------------
           三件事说清楚就够：串是什么、传上去的是什么、冲突了怎么办。
           「串」不是密码也不是账号，它就是两台设备对暗号用的同一句话。 -->
      <section class="mt-3 divide-y divide-line rounded-2xl border border-line bg-card shadow-sm" data-sync-card>
        <div class="p-4">
          <div class="flex items-center gap-3.5">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7M5 6l3 3 3-3" /><path d="M2.5 10.5A4 4 0 006 14h4a4 4 0 003.5-3.5" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">云同步（课表与待办）</span>
              <span class="block text-[11px] text-ink-dim">两台设备填同一个串，就能看到同一份课表</span>
            </span>
          </div>

          <!-- 同步串：只存本机，不上传原文（服务端只存它的 HMAC） -->
          <label class="mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2">
            <span class="shrink-0 text-xs text-ink-dim">同步串</span>
            <input
              v-model="syncPass"
              data-sync-pass
              type="password"
              autocomplete="off"
              :placeholder="`至少 ${SYNC_MIN_PASS} 个字符，只有你知道`"
              class="min-w-0 flex-1 bg-transparent text-sm outline-none"
              @keyup.enter="syncRemember"
            />
          </label>
          <div class="mt-2 flex items-center gap-2">
            <button
              data-sync-save
              class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white active:scale-[0.98]"
              @click="syncRemember"
            >保存串</button>
            <span v-if="!syncPassOk && syncPass" class="text-[11px] text-amber-600 dark:text-amber-400">
              太短了（至少 {{ SYNC_MIN_PASS }} 个字符）
            </span>
            <span v-else-if="syncUidShort" class="text-[11px] text-ink-dim">
              云端身份 {{ syncUidShort }}<template v-if="syncLastAt"> · 上次同步 {{ syncLastAt }}</template>
              <template v-if="syncCfg.rev"> · rev {{ syncCfg.rev }}</template>
            </span>
            <span v-else-if="syncCfg.pass" class="text-[11px] text-ink-dim">已存串，还没同步过</span>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-dim">
            只上传课表和待办（{{ syncSummary.keys }} 项<template v-if="syncSummary.courses || syncSummary.todos">：{{ syncSummary.courses }} 门课、{{ syncSummary.todos }} 条待办</template>）。
            录音、练耳、日精进都留本机。
          </p>
        </div>

        <!-- 冲突：云端比本机新。不自动选，两份摆出来让用户定 -->
        <div v-if="syncConflict" data-sync-conflict class="bg-amber-50 p-4 dark:bg-amber-950/30">
          <p class="text-xs font-medium text-amber-700 dark:text-amber-300">云端有一份更新的数据（rev {{ syncConflict.cloudRev }}），本机这份没被覆盖。</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-dim">要云端那份就「取回云端」；本机才对就「用本机覆盖云端」。</p>
          <div class="mt-2.5 flex items-center gap-2">
            <button
              data-sync-take-cloud
              class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white active:scale-[0.98]"
              @click="doSyncDownload"
            >取回云端</button>
            <button
              data-sync-force
              class="rounded-lg border border-line px-3 py-1.5 text-xs font-medium active:scale-[0.98]"
              @click="doSyncUpload(true)"
            >用本机覆盖云端</button>
          </div>
        </div>

        <div class="flex items-center gap-2 p-4">
          <button
            data-sync-upload
            :disabled="syncBusy || !syncPassOk || !syncHasData"
            class="flex-1 rounded-lg bg-primary-500 px-3 py-2 text-xs font-medium text-white active:scale-[0.98] disabled:opacity-40"
            @click="doSyncUpload(false)"
          >上传</button>
          <button
            data-sync-download
            :disabled="syncBusy || !syncPassOk"
            class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-medium active:scale-[0.98] disabled:opacity-40"
            @click="doSyncDownload"
          >从云端取回</button>
          <button
            data-sync-clear
            :disabled="syncBusy || !syncPassOk"
            class="rounded-lg border px-3 py-2 text-xs font-medium active:scale-[0.98] disabled:opacity-40"
            :class="syncConfirmClear ? 'border-red-400 text-red-600 dark:text-red-400' : 'border-line text-ink-dim'"
            @click="doSyncClearCloud"
          >{{ syncConfirmClear ? '再点一次确认' : '清空云端' }}</button>
        </div>

        <p
          v-if="syncMsg"
          data-sync-msg
          class="px-4 pb-3 text-[11px] leading-relaxed"
          :class="syncMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'"
        >{{ syncMsg }}</p>
      </section>

      <!-- 导入结果反馈（导入/导出都在设置页，回执也留在这里） -->
      <p
        v-if="importMsg"
        data-import-msg
        class="px-1 text-center text-xs"
        :class="importMsg.startsWith('导入成功') || importMsg.startsWith('已导出') ? 'text-primary-600' : 'text-red-600 dark:text-red-400'"
      >
        {{ importMsg }}
      </p>
</template>

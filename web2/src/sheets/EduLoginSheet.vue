<script setup>
/* P12b：登录浙大教务网抓课表（统一身份认证 + 方正 zdbk 接口）。
   口径（用户 2026-10-06 拍板，2026-10-08 升级）：
     · 「①乙」密码存本机 → 下次自动填好、不用重输。**2026-10-08 起密码不再写进 localStorage**，
       改走 Android 系统密钥库（`data/secureStore.js` + 原生 `SecureStorePlugin`）：
       AES-GCM 密文落盘、私钥永不出系统。浏览器里没有密钥库，如实退回老办法并在界面上说明。
     · 「②甲」网络走 CapacitorHttp（原生），所以**只有装到手机上才能用**；
       网页里如实报「这个环境不行」，不做假成功。
   ⚠️ 抓取**只在你点按钮时发生**：不轮询、不定时后台抓，出错也不自动重试
   （学校登录页会「输错太多次锁号」）。

   ⚠️ 为什么这个浮层**不用 BottomSheet 组件、而是自己手写**：
   本浮层是从「我的 → 设置」这个**二级页**里打开的，二级页是 `fixed inset-0 z-40`；
   而 BottomSheet 的遮罩/面板是 z-20 / z-30 —— 低于 z-40，会被二级页**整个盖住**：
   DOM 里量得到、`opacity:1`、测试断言全过，但**截图里什么都看不见**（2026-10-06 真踩了，
   两张截图字节完全相同才暴露）。所以照已验过的 `DeleteLectureSheet.vue` 那套写：
   遮罩 z-40 / 面板 z-50（同一个二级页里开浮层的既有先例）。 */
import { useApp } from '../composables/app-ctx.js'
/* eduHttpAvailable / eduSecretBackend 是 data/eduLogin.js 的模块函数（不是 App 的顶层绑定，
   进不了 APP_CTX），模板里要用就自己引一次 —— 同 HabitSheet 引 streakOf/totalDoneOf 的做法。 */
import { eduHttpAvailable, eduSecretBackend } from '../data/eduLogin.js'

const app = useApp()

const TERMS = [
  { v: '3', label: '秋冬学期' },
  { v: '12', label: '春夏学期' },
  { v: '16', label: '短学期' },
]
</script>

<template>
  <Transition name="fade">
    <div v-if="app.eduLoginOpen" data-edu-login-mask class="fixed inset-0 z-40 bg-black/40" @click="app.closeEduLogin"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="app.eduLoginOpen"
      data-edu-login
      class="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border-t border-line bg-card shadow-2xl"
      :style="{ paddingBottom: 'max(24px, calc(var(--sab, 0px) + 24px))' }"
    >
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-soft-2"></div>

        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-bold text-ink">登录教务网抓课表</h2>
          <button
            type="button"
            data-edu-login-close
            class="rounded-full bg-soft px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
            @click="app.closeEduLogin"
          >关闭</button>
        </div>

        <p class="rounded-xl bg-soft px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">
          用你的<strong class="font-semibold text-ink">统一身份认证</strong>账号登录，App 直接把课表抓回来，抓完一样<strong class="font-semibold text-ink">先给你核对</strong>再替换。<br />
          账号密码只在这台手机和学校服务器之间走，<strong class="font-semibold text-ink">不经任何第三方服务器</strong>；不勾「记住」就不存密码。
        </p>

        <p v-if="!eduHttpAvailable()" data-edu-login-noweb class="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-500">
          这个环境不能直连教务网（浏览器里会被跨域挡住）—— 装到手机 App 里才生效。
        </p>

        <div class="mt-3 space-y-2.5 pb-2">
          <label class="block">
            <span class="block text-[11px] font-medium text-ink-dim">学号</span>
            <input
              v-model="app.eduLoginUser"
              data-edu-login-user
              type="text"
              inputmode="numeric"
              autocomplete="username"
              placeholder="统一身份认证的学号"
              class="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-primary-400"
            />
          </label>

          <label class="block">
            <span class="block text-[11px] font-medium text-ink-dim">密码<span v-if="!app.eduSecretReady" class="ml-1 text-ink-dim">· 正在从密钥库读取…</span></span>
            <span class="mt-1 flex items-center gap-2">
              <input
                v-model="app.eduLoginPw"
                data-edu-login-pw
                :type="app.eduLoginShowPw ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="统一身份认证的密码"
                class="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-primary-400"
              />
              <button
                type="button"
                data-edu-login-showpw
                class="shrink-0 rounded-xl bg-soft px-3 py-2.5 text-xs font-medium text-ink-dim transition active:scale-95"
                @click="app.eduLoginShowPw = !app.eduLoginShowPw"
              >{{ app.eduLoginShowPw ? '隐藏' : '显示' }}</button>
            </span>
          </label>

          <!-- 默认勾上：用户选的「①乙」就是图这个方便 -->
          <button
            type="button"
            data-edu-login-remember
            class="flex w-full items-center gap-3 rounded-xl bg-soft px-3 py-2.5 text-left"
            @click="app.eduLoginRemember = !app.eduLoginRemember"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] font-medium">记住账号密码</span>
              <span v-if="eduSecretBackend() === 'keystore'" data-edu-login-keystore class="block text-[11px] text-ink-dim">密码存进手机的系统密钥库（Android Keystore，加密存放）</span>
              <span v-else class="block text-[11px] text-ink-dim">当前环境没有系统密钥库，只能存浏览器本地（App 里才是加密的）</span>
            </span>
            <span
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="app.eduLoginRemember ? 'bg-primary-500' : 'bg-soft-2'"
            >
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="app.eduLoginRemember ? 'left-[22px]' : 'left-0.5'"></span>
            </span>
          </button>

          <div class="flex items-center gap-2.5">
            <label class="min-w-0 flex-1">
              <span class="block text-[11px] font-medium text-ink-dim">学年</span>
              <input
                v-model="app.eduTermXnm"
                data-edu-login-xnm
                type="text"
                inputmode="numeric"
                placeholder="2026"
                class="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-primary-400"
              />
            </label>
            <label class="min-w-0 flex-1">
              <span class="block text-[11px] font-medium text-ink-dim">学期</span>
              <select
                v-model="app.eduTermXqm"
                data-edu-login-xqm
                class="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-primary-400"
              >
                <option v-for="it in TERMS" :key="it.v" :value="it.v">{{ it.label }}</option>
              </select>
            </label>
          </div>

          <!-- 教务会把**整年**的课都返回来（我们请秋冬、它给整年），所以默认按学期本地筛一遍。
               2026-10-06 真机踩到：不筛的话一整年四季的课全混进课表。 -->
          <button
            type="button"
            data-edu-login-allterms
            class="flex w-full items-center gap-3 rounded-xl bg-soft px-3 py-2.5 text-left"
            @click="app.eduKeepAllTerms = !app.eduKeepAllTerms"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] font-medium">连其他学期一起留</span>
              <span class="block text-[11px] text-ink-dim">默认只留上面选的学期；教务会把整年的都返回来，所以本地要再筛一遍</span>
            </span>
            <span
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="app.eduKeepAllTerms ? 'bg-primary-500' : 'bg-soft-2'"
            >
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="app.eduKeepAllTerms ? 'left-[22px]' : 'left-0.5'"></span>
            </span>
          </button>

          <button
            type="button"
            data-edu-login-go
            class="w-full rounded-xl bg-primary-500 py-3 text-sm font-medium text-white transition active:scale-[0.99]"
            :class="app.eduLoginBusy ? 'opacity-60' : ''"
            @click="app.onEduLogin"
          >
            {{ app.eduLoginBusy ? (app.EDU_STAGE_LABELS[app.eduLoginStage] || '处理中') + '…' : '抓取课表' }}
          </button>

          <p v-if="app.eduLoginMsg" data-edu-login-msg class="text-[11px] leading-relaxed" :class="app.eduLoginMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">
            {{ app.eduLoginMsg }}
          </p>

          <p class="text-[11px] leading-relaxed text-ink-dim">
            抓取只会<strong class="font-semibold text-ink">在你点按钮时</strong>发生：不做定时轮询、出错不自动重试（学校会锁号）。
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

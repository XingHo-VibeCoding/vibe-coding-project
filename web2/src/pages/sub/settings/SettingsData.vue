<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../../composables/app-ctx.js'

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
} = toRefs(app)
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
            <span class="block text-[11px] text-ink-dim">填一次统一身份认证账号，直接抓回来核对（不用手动导出）</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <label class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-soft">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M2 6h12M6 6v8M10 6v8" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">从教务导入课表</span>
            <span class="block text-[11px] text-ink-dim">选教务导出的 .xlsx，先核对再替换（待办和日程不动）</span>
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
              换教务课表前自动存的（{{ eduSnapshot.courses }} 门课<template v-if="eduSnapshot.added">，含 {{ eduSnapshot.added }} 门手动加的</template>）
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
            <span class="block text-[11px] text-ink-dim">整学期课表装进手机系统日历，带课前提醒</span>
          </span>
        </button>
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

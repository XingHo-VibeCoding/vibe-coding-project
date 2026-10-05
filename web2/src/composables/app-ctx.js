import { inject } from 'vue'

/* ============================================================================
   Stage 9（组件化）：App 的共享上下文。
   App.vue 仍是唯一的状态持有者（所有 ref/computed/函数都在它手里），
   它在这里 provide 一个 reactive() 包过的对象；拆出去的页面/浮层组件用 useApp() 取，
   于是搬 markup 时不用层层传 props，也不会产生第二份状态。

   为什么用 reactive() 而不是裸对象：reactive 会把里面的 ref 自动解包，
   所以子组件里 `app.tab` 读到的就是值、`app.tab = 'week'` 就等于改那个 ref；
   模板里也不用到处写 .value。

   注意：App.vue 顶层的 19 个 let 都是计时器/下载句柄这类内部变量，
   模板里一个都没用到（已核对），所以「reactive 快照化普通 let」这条在这里不成立。
   ============================================================================ */
export const APP_CTX = Symbol('app-ctx')

/** 取共享上下文；只在 App.vue 之下的组件里可用。 */
export function useApp() {
  const ctx = inject(APP_CTX, null)
  if (!ctx) throw new Error('useApp() 必须在 App.vue 子树内使用，且 App 已 provide(APP_CTX)')
  return ctx
}

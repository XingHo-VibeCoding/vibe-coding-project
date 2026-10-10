---
name: verify-project
description: 发布前检查清单——密钥与仓库卫生、云端错误口径、前端不变量、构建与质量门、出包链、纪律项，共 18 条。每次要交付（推代码 / 出 APK / 发演示链接）之前跑一遍 skills/verify-project/verify.mjs，逐项 PASS/FAIL 带证据，末尾给总结论。
---

# verify-project —— 发布前检查

> 用途：交付前的最后一道闸。**一条命令**把「可能悄悄坏掉」的环节全查一遍，输出逐项 `PASS/FAIL/SKIP` + 一行证据，末尾给「发布检查：通过 / 未通过」。
> 原则：每一条都来自本项目**真实踩过的坑**，不是形式主义——违反过就会出真 bug（跨域报错、环境变量没生效、重复写入、假 release 包…）。

## 怎么跑

```bash
node skills/verify-project/verify.mjs          # 全量（含构建 / 质量扫描 / 基线 / 验包，几分钟）
node skills/verify-project/verify.mjs --fast   # 快档：跳过 D2/D3/D4/E1（改动前端小逻辑时用）
```

退出码即结论：**任一 FAIL → 1；全 PASS（SKIP 不算 FAIL）→ 0**。明细会同时写进 `skills/verify-project/last-run.txt`，方便归档和贴图。

## 检查项（18 条）

### A 组｜密钥与仓库卫生
| # | 检查 | 通过标准 |
|---|---|---|
| A1 | 跟踪文件里没有真实密钥 | 按密钥**真实形状**（`AKID…` / 私钥块 / `sk-…` / JWT / 带密码连接串 / 赋值型真值）扫全部跟踪文本文件，0 命中 |
| A2 | `.gitignore` 否定规则生效 | `git check-ignore -v .env.example` **无输出**（放行）、`.env` 与 `cloudbaserc.json` 命中规则（忽略） |
| A3 | 机密文件未被跟踪 | `git ls-files` 里没有 `.env` / `cloudbaserc.json` / `*.key` / `*.pem` |
| A4 | 占位符模板已入库 | `.env.example` + `cloudbaserc.example.json` 都在且都被跟踪 |

### B 组｜云端错误口径
| # | 检查 | 通过标准 |
|---|---|---|
| B1 | 两份 `errors.js` 逐字节一致 | `cloudfunctions/list/errors.js` 与 `cloudfunctions/write/errors.js` **裸 SHA256 相同**（项目规矩八.5）。⚠ 坑：本仓 `core.autocrlf=true`，若只有一侧被 git 改写成 CRLF，裸字节就不相等；证据里会区分「内容真不同」和「纯 CRLF/LF 差异」，后者用 `git -c core.autocrlf=false checkout -- <文件>` 还原 |
| B2 | 失败响应是人话 | **实调**两份模块的 `toResponse()`，喂 `Error` / `{}` / `null` / 字符串 四类输入，每个都返回 `{ok:false,kind,message,status}` 且 message 非空、不含 `[object Object]` |

### C 组｜前端不变量
| # | 检查 | 通过标准 |
|---|---|---|
| C1 | `APP_CTX` 无漏解构 | `node web2/tmp/gen-app-ctx.mjs --check` exit 0 且不报「过期」 |
| C2 | 二级页安全区 | `node web2/tmp/safe-area-check.mjs` 全通过 |
| C3 | 时间行只有一处实现 | 全仓 `web2/src` 下 `RowItem` 实现处数量 = 1 |

### D 组｜构建与质量门
| # | 检查 | 通过标准 | 档位 |
|---|---|---|---|
| D1 | 本地静态服务可访问 | `127.0.0.1:4177` 探通；**没起就自己 detached 拉起**再探 | 全档 |
| D2 | 生产构建通过 | `vite build` exit 0 且 `web2/dist/index.html` 存在 | 全量 |
| D3 | 全页质量扫描 0 处问题 | `node tmp/quality-scan.mjs` 输出「合计：0 处问题」 | 全量 |
| D4 | 测试基线无非 0 退出 | `node tmp/day19-baseline.mjs` 产物 `tmp/day19-baseline.txt` 里 `[exit N]` 行的非 0 数 = 0（⚠ 该脚本控制台**不打印汇总句**，末行只是失败脚本名，所以必须读产物文件而不是 grep 控制台） | 全量 |

### E 组｜出包链
| # | 检查 | 通过标准 | 备注 |
|---|---|---|---|
| E1 | APK 三方一致 | `web2/dist ↔ app/www ↔ APK` 逐文件 SHA256 一致 | 无 APK 或 APK 比 dist 旧 → SKIP（不算 FAIL，但会明说） |
| E2 | release 不是假包 | `apksigner verify --print-certs` 的 DN 不含 `Android Debug` | 只有 debug 包 → SKIP。⚠ Windows 上必须经 `cmd /c <apksigner.bat>` 调用：直接 spawn `.bat` 会 `exit=null` 且读不到 DN |
| E3 | 版本号处处对 | `web2/package.json` = dist 内嵌版本 = 最新 APK 名版本 | 全档 |

### F 组｜纪律项
| # | 检查 | 通过标准 |
|---|---|---|
| F1 | 推送前连通性预检 | **实地**探 `https://github.com`（环境变量代理为空也要探），失败则回退 `git ls-remote origin` |
| F2 | 动了数据模型则三份文档同步 | 本次改动/最新提交若碰了 `store.js` / `schema_version`，则 `大学生日程助手-设计方案.md` / `PRD.md` / `TECH_DESIGN.md` 三份都得在改动清单里；没碰模型则直接 PASS |

## SKIP 的口径

`SKIP` 意为「本机条件下这条无从判定」，**不算 FAIL、退出码仍可为 0**，但总结论会明确列出跳过了哪几条。触发 SKIP 的情形：

- `--fast` 跳过 D2 / D3 / D4 / E1（快档不做出包链与重活）。
- E1 / E2：本机没有 APK 产物，或最新 APK 比 `web2/dist` 旧（说明有改动还没出包）——这时应去壳仓跑 `npm run ship` 而不是把检查判红。

## 改检查项的规矩

1. 新增检查项必须写清**执行命令 + 通过标准**，并且能在输出里给出一行证据；不给证据的检查项等于没检查。
2. 新写的检查项**先自证会报红**：故意造一个坏样例，确认它真的 FAIL，再恢复。静默假通过的检查器比没有检查器更危险。
3. 检查器本身**只读**：除 D1 起服务、D2/D4 落构建与基线产物外，不许写入被检查的文件。
4. 动了项目真实踩过的坑 → 顺手加一条进来（坑的来源写在证据文案里）。

## 调用记录

> 每次真实调用本清单，在这里追加一行：日期 ｜ 用在哪个改动 ｜ 结论（几条 PASS/FAIL/SKIP、有无新增规则）。

- 2026-10-09 ｜ Day 25 制作本 Skill（板块③实跑验证）｜ 首轮跑出误报并修正；随后故意改坏 `cloudfunctions/list/errors.js` 一个字节，确认 B1 真的报 FAIL，`git checkout` 恢复后复跑全绿。

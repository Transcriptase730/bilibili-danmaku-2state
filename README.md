# Bilibili 弹幕两态化 / Bilibili Danmaku 2-State

干掉 B 站网页端弹幕开关的「**精简弹幕**」中间态，把开关恢复成只有 **开启 / 关闭** 两个可用状态。

点击不再走 `开启 → 精简 → 关闭` 三步循环，悬停提示里也不会再出现「精简弹幕 (d)」。

---

## 安装

### 方式一：用户脚本管理器（推荐，长期生效）

需要 [Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) / [ScriptCat](https://scriptcat.org/)。

1. 安装管理器后新建脚本，把 [`bilibili-danmaku-2state.user.js`](./bilibili-danmaku-2state.user.js) 整个内容粘进去保存。
2. 打开任意 B 站视频页，弹幕开关即恢复两态。
3. 默认在中文环境生效；脚本自带看门狗，切集 / 换 P / 全屏后仍会自愈。

### 方式二：控制台速用（临时试水）

打开视频页 → `F12` → Console → 粘贴 [`bilibili-danmaku-2state.console.js`](./bilibili-danmaku-2state.console.js) → 回车。

关掉页面即失效，只用来确认效果。

---

## 原理

逆向自线上播放器 bundle（`bfs/static/player/main/core.*.js` 与 `widgets/npd.*.js`）：

| 环节 | 事实 |
| --- | --- |
| 三态枚举 | `Unset=0 / Open=1 / Concise=2 / Closed=3`，`Concise` 就是「精简弹幕」 |
| 总开关 | `ExpStore.enableDmThreeState` = `localeRestrictedExperimentsEnabled`(中文环境为真) **且** `getExpOrKvBool("dm_three_state_switch", …)` |
| 取值来源 | `getAbValue` 实时读 `window.webAbTest["dm_three_state_switch"]`（`globalABKey = "webAbTest"`），读不到才回落 `localStorage["bilibili_player_kv_config"].dash_config` |
| 循环逻辑 | `nextDmSwitchState()` → `1→2, 2→3, 默认→1`，这就是那个多余的中间态 |
| UI 判定 | 三态时容器带 `*-danmaku-switch-new`；状态 2 渲染为 `indeterminate` + `aria-checked="mixed"` + `*-danmaku-switch-state-2` |
| 悬停文案 | `danmakuStatus === cF.Concise` 时硬编码 `"精简弹幕 (d)"` |
| 官方 API | `window.player.danmaku.open() / close() / isOpen()`；点击回调走 `switchState(nextState())` |

**关键结论**：`enableDmThreeState` 为 `false` 时，播放器会退回原生两态开关组件（`dmSwitch.setDmSwitch(bool)` 路径）。
所以主手段不是去"点掉"中间态，而是把 `window.webAbTest.dm_three_state_switch` 钉死为 `false`。

### 四层防线

1. `document-start` 阶段用 accessor 属性定义 `webAbTest` / `abtest`，把目标键钉成**赋值也改不回去**的 `false`。
2. 顺手滤掉 `localStorage` 回落配置里的同名字段。
3. 点击与 `d` 快捷键在**捕获阶段**接管：一旦发现三态仍生效，直接 `开启 ⇄ 关闭` 一步到位。
4. `MutationObserver`（只观察开关节点）+ 1 秒兜底轮询：仍看见「精简」态就就地纠正。

---

## 配置

脚本顶部 `CFG`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `conciseFallback` | `'open'` | 万一三态仍生效，检测到「精简」时落到哪个状态：`'open'` 弹幕开启 / `'closed'` 弹幕关闭 |
| `stripKvConfig` | `true` | 是否过滤 `localStorage` 中的回落配置 |
| `guardHotkeyD` | `true` | 是否接管 `d` 快捷键（输入框内不受影响） |
| `debug` | `false` | 打开后控制台输出 `[dm-2state]` 日志 |

---

## 兼容性

- 只在 B 站中文环境的**网页端播放器**生效；账号未被灰度到时脚本静默共存，无副作用。
- 若站方后续把判断搬进闭包（不再读 `window.webAbTest`），第 3、4 层仍能兜住；届时把 `CFG.debug = true` 的日志提 issue。

---

## 目录结构

```
.
├── bilibili-danmaku-2state.user.js      # 用户脚本（推荐装这个）
├── bilibili-danmaku-2state.console.js   # 控制台速用版（临时试水）
├── LICENSE                              # MIT
├── README.md
└── .github/workflows/lint.yml           # CI：node --check 语法校验
```

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。

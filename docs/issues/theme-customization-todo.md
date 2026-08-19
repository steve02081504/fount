# 主题样式硬编码 — 无法自动检测的项目（TODO）

> 现状：`checks:theme_radius`（`src/scripts/checks/theme_radius.mjs`）能自动检出**圆角**与**边框宽度**的硬编码。
> 以下类别因为难以区分「有意语义 / 品牌色」vs「误写死的主题色」，暂未纳入自动检测，靠人工排查。

## 无法检测的原因

颜色不像圆角 / 边框宽度那样语义纯粹：
- **品牌色 / 功能色**（Discord 蓝 `#5865f2`、告警红、用户自定义的 profile 主题色）本就不该随 UI 主题变 —— 是**合理**的硬编码。
- **误写死的主题色**（本该用 `bg-error` / `var(--color-error)` 却写了 `#e11d48`）才是**违反**。

自动扫描无法可靠区分这两种，硬做会刷屏误报。以下是疑似违反点，需人工逐一判断。

## 疑似写死主题色的位置（待人工排查）

| 位置 | 颜色 | 疑似用途 | 建议 |
| --- | --- | --- | --- |
| `.github/pages/wait/install/index.css:427-436` | `#e11d48` | 错误告警 | 改用 `bg-error` / `var(--color-error)` |
| `.github/pages/wait/install/index.css:382` | `#ff3b3b` / `#ffd60a` / `#32d74b` / `#0a84ff` / `#bf5af2` | conic-gradient 装饰 | 确认是否应随主题 |
| `.github/pages/wait/install/index.css:408` | `#111` / `#f5c518` | 斑马纹背景 | 确认是否应随主题 |
| `src/public/pages/server-status.php.html` | `#ffffff` / `#000000` / `#cccccc` | 全页颜色 | 改用 `--color-base-*` / `--color-base-content` |
| `src/public/pages/scripts/features/markdown/standaloneDocument.mjs:73,78` | `#ccc` / `#007bff` | 离线导出文档 | 改用 `var(--color-base-300)` / `var(--color-info)` |
| `src/public/pages/scripts/features/markdown/convertor.mjs:1279` | `#11451400` | 代码高亮背景 | 确认 |
| `src/public/parts/shells/chat/public/hub/widgets.css:1190` | `#ff6b6e` | 错误红 | 改用 `var(--color-error)` |
| `src/public/parts/shells/chat/public/hub/widgets.css:306,310` | `#f0b232` / `#f23f43` | 徽标色 | 确认 |
| `src/public/parts/shells/browserIntegration/public/script.user.js:809,823` | `#333` / `#3B82F6` | 注入脚本（脱离主题环境） | 低优先，脚本运行于第三方页面 |

## 若未来要自动化的思路

- 只报**不在语义色白名单内**、且能**映射到 daisyUI 主题色**（`bg-*` / `--color-*`）的 hex → 需维护一个品牌 / 语义色白名单，噪音可控后再启用。
- 或按目录缩范围：先只查 `.github/pages/wait/install` 等已知主题化静态站，不碰品牌色多的 shell。

#!/usr/bin/env -S deno run -A
/**
 * fount 喷泉 logo ASCII 动画。
 *
 * 材质（见 AGENTS.md）：
 *   body `@`  — 冲击外壳（溅起后消失）
 *   `:`       — 纯视觉水柱（不阻挡流体）
 *   base `@`  — 向下渗漏的水池 | `>`/`<` — 45° 飞溅
 *   terrain   — 土壤蓄水；天花板凝结并滴落
 *
 * createAnimState({ width?, height?, seed? }) — 可用时默认终端尺寸。
 * 主流程：入场 → 循环保持 → Ctrl+C / 长按 ESC≥4s → 从当前进度退场。
 * 指针：左键快击 → 明亮扩散涟漪；左键按住 → 聚光灯；
 *   右键拖拽笔画风；右键长按静止 → 顺时针涡旋（跟随 / 重组 / 释放清除）。
 */

import process from 'node:process'

import * as icon from './session.mjs'

/** 图标布局常量与打包轮廓辅助。 */
export {
	ICON_W, ICON_H, ICON_PACK_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
	ICON_BODY_H, maxBodyD, maxPillarH,
} from './icon.mjs'
/** 网格 / 缓冲帧合成器。 */
export { renderBuffers, renderGrid } from './compose.mjs'
/** 动画状态机（入场 / 保持 / 退场）。 */
export {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'
/** 交互式 TUI 会话。 */
export {
	signal, abort, start, intro, dismiss, farewell, sleep,
} from './session.mjs'
/** 底层播放器工具。 */
export { fps, terminalSize, consumeStdin } from './player.mjs'

if (import.meta.main) {
	await icon.start()
	await icon.farewell()
	process.exit(icon.signal.aborted ? 130 : 0)
}

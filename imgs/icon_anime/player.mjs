/**
 * TUI 播放器入口：按 `document` 选择 Node / 浏览器宿主（默认 IO 在 `io.mjs` 加载）。
 */

/** ESC 计时、stdin 解析、帧循环与备用屏。 */
export {
	ESC_HOLD_MS, ESC_HOLD_GAP_MS, createEscHold, consumeStdin, fps,
	abort, refreshSignal, start, paint, play, loop, stop,
} from './player/shared.mjs'

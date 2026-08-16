/**
 * 终端尺寸 / TUI 可用性：按 `document` 选择 Node / 浏览器宿主（默认 IO 在 `io.mjs` 加载）。
 */

/** TUI 可用性、尺寸订阅与 `setIO`。 */
export { canUseTui, terminalSize, watchTerminalSize, setIO } from './io.mjs'

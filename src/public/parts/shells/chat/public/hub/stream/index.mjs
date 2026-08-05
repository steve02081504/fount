/**
 * 【文件】public/hub/stream/index.mjs
 * 【职责】群 Hub WebSocket 协调入口：汇总生命周期与 volatile 流式预览的对外 API。
 *
 * 生命周期见 connection.mjs；wire 分发见 handlers/；流式槽见 volatileSlots.mjs。
 */
export {
	closeGroupWebSocket,
	connectGroupWebSocket,
	isGroupWebSocketOpen,
	waitForGroupWebSocketOpen,
} from './connection.mjs'
/** WebSocket 出站：发消息 / typing / 报错处理。 */
export {
	attachGroupWebSocketErrorHandlers,
	reportTyping,
	sendWebsocketMessage,
	stopGeneration,
} from './outbound.mjs'
/** 流式预览槽：volatile chunk DOM 与 stop 按钮。 */
export {
	dismissVolatileStreamPreview,
	getActiveVolatileStreamIds,
	refreshStopGenerationButton,
	resetVolatileStreamState,
	resumeActiveStreamBuffers,
	syncStreamingSlotsFromDom,
} from './volatileSlots.mjs'

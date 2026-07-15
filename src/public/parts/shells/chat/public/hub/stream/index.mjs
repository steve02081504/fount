/**
 * 【文件】public/hub/stream/index.mjs
 * 【职责】群 Hub WebSocket 协调入口：汇总生命周期、回调注册、volatile 流式预览的对外 API。
 *
 * 生命周期见 connection.mjs；wire 分发见 handlers/；流式槽见 volatileSlots.mjs。
 */
export {
	setGenerationActiveChangeHandler,
	setGroupChannelRefreshHandler,
	setGroupMessageDeleteHandler,
	setGroupMessageEditHandler,
	setGroupStreamEndHandler,
	setGroupThreadChannelRefreshHandler,
} from './callbacks.mjs'
/**
 *
 */
export {
	closeGroupWebSocket,
	connectGroupWebSocket,
	isGroupWebSocketOpen,
	waitForGroupWebSocketOpen,
} from './connection.mjs'
/**
 *
 */
export {
	dismissVolatileStreamPreview,
	getActiveVolatileStreamIds,
	resetVolatileStreamState,
	resumeActiveStreamBuffers,
	syncStreamingSlotsFromDom,
} from './volatileSlots.mjs'

/**
 * 【文件】stream/groupWsHub.mjs
 * 【职责】群 WebSocket 子模块聚合门面：统一 re-export RPC、限流、广播、流缓冲、身份注册等入口，供 session/endpoints 单点 import。
 * 【原理】无本地状态，仅转发同目录实现；联邦 volatile 与 RPC 响应经 groupWsRpc/groupWsBroadcast 与 federation 层衔接。
 * 【数据结构】无；导出符号来自 groupWsRpc、groupWsRateLimit、groupWsBroadcast、groupWsStreamBuffer。
 * 【关联】groupWsRpc.mjs、groupWsBroadcast.mjs、session/wsLifecycle.mjs、federation/volatile.mjs、room char_rpc_response。
 */
export {
	handleGroupSocketIdentityMessage,
	handleGroupSocketRpcMessage,
	relayOrConsumeRpcResponse,
	registerRpcClientIdentity,
} from './groupWsRpc.mjs'

/**
 * 群 WebSocket 连接速率限制与 PoW 挑战校验。
 */
export { checkWsRateLimit, setPowChallenge, verifyPowSolution } from './groupWsRateLimit.mjs'

/**
 * 群事件 WebSocket 广播与连接注册。
 */
export { broadcastEvent, countGroupSockets, registerSocket } from './groupWsBroadcast.mjs'

/**
 * 流式消息分片缓冲的写入、结束与读取。
 */
export {
	bufferStreamChunk,
	finishStreamBuffer,
	getBufferedStreamChunks,
} from './groupWsStreamBuffer.mjs'

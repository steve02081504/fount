/**
 * Part wire 公共入口：入站挂载见 part_wire_ingress；fanout/collect 见 part_wire_fanout；Social RPC 见 part_wire_social_rpc。
 * 载荷与响应形状见 part_invoke.mjs。
 */
export {
	TIMELINE_FANOUT_LIMIT,
	PART_INVOKE_FANOUT_DEFAULT,
	USER_ROOM_PEER_FANOUT_DEFAULT,
	buildPartInvokePayload,
	partInvokeDataRows,
	partInvokeErrorMessages,
} from './part_wire_common.mjs'

/**
 *
 */
export {
	attachPartWire,
	handleIncomingPartInvokeRequest,
	handleIncomingPartInvokeFireAndForget,
	handleIncomingPartInvokeResponse,
} from './part_wire_ingress.mjs'

/**
 *
 */
export {
	collectPartInvokeResponses,
	publishTimelineEvent,
	fanoutPartInvoke,
} from './part_wire_fanout.mjs'

/**
 *
 */
export {
	wrapSocialRpc,
	collectSocialRpcResponses,
	collectSocialRpcMerged,
} from './part_wire_social_rpc.mjs'

import { getNodeHash } from '../../../../../../scripts/p2p/node/identity.mjs'
import { getShellPartpath } from '../../../../../../scripts/p2p/part_path_registry.mjs'
import { TIMELINE_FANOUT_LIMIT } from '../../../../../../scripts/p2p/part_wire_common.mjs'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from '../../../../../../scripts/p2p/trust_graph_registry.mjs'

/**
 * 将签名时间线事件 fanout 到信任图 Top 节点。
 * @param {string} username replica
 * @param {string} entityHash owner
 * @param {object} signedEvent 签名事件
 * @returns {Promise<number>} 发送次数
 */
export async function publishTimelineEvent(username, entityHash, signedEvent) {
	return requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).fanoutToTopNodes(username, 'part_timeline_put', {
		nodeHash: getNodeHash(),
		partpath: getShellPartpath('social'),
		timelineEntityHash: entityHash.toLowerCase(),
		event: signedEvent,
	}, TIMELINE_FANOUT_LIMIT)
}

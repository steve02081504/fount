import { getNodeHash } from '../../../../../../scripts/p2p/node_context.mjs'
import { getOperatorEntityHashProvider } from '../../../../../../scripts/p2p/social/follower_index_registry.mjs'
import { filterTimelineEventsForFederation } from '../../../../../../scripts/p2p/timeline/federation_visibility.mjs'
import { canViewPost } from '../feedHelpers.mjs'

import { getTimelineMaterialized } from './materialize.mjs'
import { listLocalEntitiesForNode } from './ownerIndex.mjs'

/**
 * @param {string} username replica
 * @param {string | null | undefined} requesterNodeHash 64 hex
 * @param {string} ownerEntityHash 时间线 owner
 * @returns {Promise<{ requesterEntityHash: string | null, followsOwner: boolean, isOwner: boolean, isProtected: boolean }>} 请求者上下文
 */
async function resolveFederationRequesterContext(username, requesterNodeHash, ownerEntityHash) {
	const owner = String(ownerEntityHash).toLowerCase()
	const localNode = getNodeHash()
	const requesterNode = requesterNodeHash?.trim().toLowerCase() || null
	const ownerView = await getTimelineMaterialized(username, owner)
	const isProtected = Boolean(ownerView.socialMeta?.isProtected)

	if (!requesterNode)
		return { requesterEntityHash: null, followsOwner: false, isOwner: false, isProtected }

	if (requesterNode === localNode) {
		const resolveOperator = getOperatorEntityHashProvider()
		const operator = resolveOperator ? await resolveOperator(username) : null
		const operatorView = operator ? await getTimelineMaterialized(username, operator) : null
		return {
			requesterEntityHash: operator,
			followsOwner: operatorView?.following?.includes(owner) ?? false,
			isOwner: operator?.toLowerCase() === owner,
			isProtected,
		}
	}

	for (const entityHash of await listLocalEntitiesForNode(username, requesterNode)) {
		const view = await getTimelineMaterialized(username, entityHash)
		return {
			requesterEntityHash: entityHash,
			followsOwner: view.following.includes(owner),
			isOwner: entityHash === owner,
			isProtected,
		}
	}

	return { requesterEntityHash: null, followsOwner: false, isOwner: false, isProtected }
}

/**
 * 联邦 RPC 出站：按可见性过滤时间线事件（外来 ingress 响应边界）。
 * @param {string} username 本地 replica
 * @param {string} ownerEntityHash 时间线 owner
 * @param {object[]} events 原始事件
 * @param {string | null | undefined} requesterNodeHash 请求方 nodeHash
 * @returns {Promise<object[]>} 过滤后的事件
 */
export async function filterEventsForFederatedPull(username, ownerEntityHash, events, requesterNodeHash) {
	const owner = String(ownerEntityHash).toLowerCase()
	const requesterContext = await resolveFederationRequesterContext(username, requesterNodeHash, owner)
	return filterTimelineEventsForFederation(events, owner, requesterContext, canViewPost)
}

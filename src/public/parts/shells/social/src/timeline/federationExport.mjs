import { resolveOperatorEntityHash } from './lib/operatorEntity.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node_context.mjs'
import { canViewPost } from '../feedHelpers.mjs'

import { getTimelineMaterialized } from './materialize.mjs'
import { listLocalEntitiesForNode } from './ownerIndex.mjs'


/** 联邦 pull 永不外泄的类型 */
const FEDERATION_PRIVATE_EVENT_TYPES = new Set(['follow', 'unfollow', 'follow_approve', 'like', 'unlike', 'file_share'])

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
		const operator = await resolveOperatorEntityHash(username)
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
 * @param {object} event 时间线事件
 * @param {string} ownerEntityHash owner
 * @param {object} requesterContext 请求者上下文
 * @returns {boolean} 是否可联邦导出
 */
function isTimelineEventVisibleForFederation(event, ownerEntityHash, requesterContext) {
	const type = event.type
	if (FEDERATION_PRIVATE_EVENT_TYPES.has(type)) return false
	if (requesterContext.isOwner) return true

	if (type === 'social_meta') return !requesterContext.isProtected

	if (type === 'post' || type === 'repost')
		return canViewPost(
			{ entityHash: ownerEntityHash, content: event.content },
			requesterContext.requesterEntityHash,
			new Set(),
			new Set(requesterContext.followsOwner ? [ownerEntityHash] : []),
		)

	if (type === 'post_delete') return true

	return false
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
	return events.filter(event => isTimelineEventVisibleForFederation(event, owner, requesterContext))
}

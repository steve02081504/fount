import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { getOperatorEntityHashProvider } from '../federation/follower/registry.mjs'
import { filterTimelineEventsForFederation } from '../federation/visibility.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { latestFollowWallForAuthor } from '../lib/replyPolicy.mjs'

import { getTimelineMaterialized } from './materialize.mjs'
import { listLocalEntitiesForNode } from './ownerIndex.mjs'

/**
 * federation_visibility 使用的 (post, requesterEntityHash, blocked, following, followSince) 形状适配。
 * @param {object} post 帖子视图
 * @param {string | null} requesterEntityHash 请求者 entityHash
 * @param {Set<string>} blocked 个人拉黑集合
 * @param {Set<string>} following 请求者关注集合
 * @param {Map<string, number>} [followSince] 关注起始 wall
 * @returns {boolean} 是否可见
 */
function canViewPostForFederationExport(post, requesterEntityHash, blocked, following, followSince = new Map()) {
	return canViewPost(post, {
		viewerEntityHash: requesterEntityHash,
		following,
		followSince,
		at: Date.now(),
		personalFilter: {
			blockedEntityHashes: blocked,
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		},
	})
}

/**
 * @param {string} username replica
 * @param {string | null | undefined} requesterNodeHash 64 hex
 * @param {string} ownerEntityHash 时间线 owner
 * @returns {Promise<object>} 请求者上下文
 */
async function resolveFederationRequesterContext(username, requesterNodeHash, ownerEntityHash) {
	const owner = String(ownerEntityHash).toLowerCase()
	const localNode = getNodeHash()
	const requesterNode = requesterNodeHash?.trim().toLowerCase() || null
	const ownerView = await getTimelineMaterialized(username, owner)
	const hideFromDiscovery = Boolean(ownerView.socialMeta?.hideFromDiscovery)
	const { loadTaste } = await import('../taste/store.mjs')
	const taste = await loadTaste(username, owner)
	const publishReactions = taste.privacy.publishReactions !== false
	const publishPreferences = taste.privacy.publishPreferences !== false
	const albums = ownerView.albums || {}

	/**
	 * @param {string | null} entityHash 请求者
	 * @param {boolean} followsOwner 是否关注
	 * @param {boolean} isOwner 是否 owner
	 * @param {Map<string, number>} [followSince] 关注时长
	 * @returns {object} context
	 */
	function base(entityHash, followsOwner, isOwner, followSince = new Map()) {
		return {
			requesterEntityHash: entityHash,
			followsOwner,
			isOwner,
			hideFromDiscovery,
			publishReactions,
			publishPreferences,
			followSince,
			albums,
		}
	}

	if (!requesterNode)
		return base(null, false, false)

	if (requesterNode === localNode) {
		const resolveOperator = getOperatorEntityHashProvider()
		const operator = resolveOperator ? await resolveOperator(username) : null
		const operatorView = operator ? await getTimelineMaterialized(username, operator) : null
		const followsOwner = operatorView?.following?.includes(owner) ?? false
		/** @type {Map<string, number>} */
		const followSince = new Map()
		if (followsOwner && operatorView) {
			const wall = latestFollowWallForAuthor(operatorView, owner)
			if (wall != null) followSince.set(owner, wall)
			else if (operator?.toLowerCase() === owner) followSince.set(owner, 0)
		}
		return base(operator, followsOwner, operator?.toLowerCase() === owner, followSince)
	}

	for (const entityHash of await listLocalEntitiesForNode(username, requesterNode)) {
		const view = await getTimelineMaterialized(username, entityHash)
		const followsOwner = view.following.includes(owner)
		/** @type {Map<string, number>} */
		const followSince = new Map()
		if (followsOwner) {
			const wall = latestFollowWallForAuthor(view, owner)
			if (wall != null) followSince.set(owner, wall)
			else if (entityHash === owner) followSince.set(owner, 0)
		}
		return base(entityHash, followsOwner, entityHash === owner, followSince)
	}

	return base(null, false, false)
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
	return filterTimelineEventsForFederation(events, owner, requesterContext, canViewPostForFederationExport)
}

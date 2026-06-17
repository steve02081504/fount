import { getProfile } from '../../../../../scripts/p2p/entity/profile.mjs'
import { collectSocialRpcMerged } from '../../../../../scripts/p2p/part_wire.mjs'
import { SOCIAL_RPC_TYPES } from '../../../../../scripts/p2p/social_namespace.mjs'

import { listLocalTimelineOwners } from './feedHelpers.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'
import { buildFederatedTimelinePullResponse } from './timeline/sync.mjs'

/**
 * 探索页推荐公开账户（跳过受保护时间线）。
 * @param {string} username 用户
 * @param {object} [options] 探索选项
 * @param {number} [options.n=20] 返回账户数
 * @param {string} [options.cursor] 分页游标（entityHash）
 * @returns {Promise<{ accounts: object[], nextCursor: string | null }>} 推荐账户
 */
export async function discoverAccounts(username, options = {}) {
	const accountLimit = Math.min(Math.max(Number(options.n) || 20, 1), 100)
	const cursor = (options.cursor || '').toLowerCase()
	const owners = await listLocalTimelineOwners(username)
	const start = cursor ? Math.max(0, owners.indexOf(cursor) + 1) : 0
	const slice = owners.slice(start, start + accountLimit)
	/** @type {object[]} */
	const accounts = []
	for (const entityHash of slice) {
		const view = await getTimelineMaterialized(username, entityHash)
		if (view.socialMeta?.isProtected) continue
		// listLocalTimelineOwners 含已同步的远端时间线；getProfile 对其返回派生默认资料，
		// 不可用 ensureLocalEntityProfile（远端会抛错使探索接口 500）。
		const profile = await getProfile(entityHash, username)
		accounts.push({
			entityHash,
			name: profile?.name || entityHash.slice(0, 8),
			exploreBlurb: view.socialMeta?.exploreBlurb || '',
			avatarUrl: profile?.avatar || null,
		})
	}
	const nextIndex = start + slice.length
	return {
		accounts,
		nextCursor: nextIndex < owners.length ? owners[nextIndex] : null,
	}
}

/** 遍历 owner 时多采样的倍数，供后续 shuffle 截断以保证随机性。 */
const POST_DISCOVER_SAMPLE_MULTIPLIER = 3

/**
 * @param {string} username 用户
 * @param {object} [options] 探索选项
 * @param {number} [options.n=20] 返回帖子数
 * @param {boolean} [options.mediaOnly=false] 仅含媒体
 * @returns {Promise<{ posts: object[] }>} 随机帖子样本
 */
export async function discoverPosts(username, options = {}) {
	const postLimit = Math.min(Math.max(Number(options.n) || 20, 1), 100)
	const mediaOnly = Boolean(options.mediaOnly)
	const owners = await listLocalTimelineOwners(username)
	/** @type {object[]} */
	const posts = []

	for (const entityHash of owners) {
		if (posts.length >= postLimit * POST_DISCOVER_SAMPLE_MULTIPLIER) break
		const view = await getTimelineMaterialized(username, entityHash)
		if (view.socialMeta?.isProtected) continue
		for (const post of view.posts) {
			if (post.content?.visibility === 'followers') continue
			if (mediaOnly && !post.content?.mediaRefs?.length) continue
			posts.push({
				entityHash,
				postId: post.id,
				textSnippet: (post.content?.text || '').slice(0, 280),
				mediaThumbs: post.content?.mediaRefs.slice(0, 4) || [],
				hlc: post.hlc,
			})
		}
	}

	for (let index = posts.length - 1; index > 0; index--) {
		const randomIndex = Math.floor(Math.random() * (index + 1))
		;[posts[index], posts[randomIndex]] = [posts[randomIndex], posts[index]]
	}

	const sampledPosts = posts.slice(0, postLimit)
	return { posts: sampledPosts }
}

/**
 * 读取指定 entity 的 following 列表（本地物化视图；受保护账户对外 RPC 返回空）。
 * @param {string} username 用户
 * @param {string} entityHash 目标
 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站
 * @returns {Promise<string[]>} 本地可见 following 列表
 */
export async function discoverFollowGraph(username, entityHash, ingress = {}) {
	const id = entityHash.toLowerCase()
	const view = await getTimelineMaterialized(username, id)
	if (view.socialMeta?.isProtected) {
		const { getNodeHash } = await import('../../../../../scripts/p2p/node_context.mjs')
		const { resolveOperatorEntityHashForUser } = await import('../../../../../server/p2p_server/operator_identity.mjs')
		const requesterNode = (ingress.requesterNodeHash || '').trim().toLowerCase()
		const operator = await resolveOperatorEntityHashForUser(username)
		const isOwnerRequest = requesterNode === getNodeHash() || operator?.toLowerCase() === id
		if (!isOwnerRequest) return []
	}
	return view.following
}

/**
 * 探索页：合并本地 + 邻居 RPC 结果。
 * @param {string} username 用户
 * @param {object} rpc RPC 请求体
 * @returns {Promise<object>} 合并结果
 */
export async function discoverWithNetwork(username, rpc) {
	const local = await handleSocialRpc(username, rpc, {})
	const { data: remote, errors: remoteErrors } = await collectSocialRpcMerged(username, rpc)
	if (remoteErrors.length)
		console.warn('social: neighbor RPC errors', { type: rpc.type, count: remoteErrors.length })
	const merged = { ...local }
	if (rpc.type === 'social_discover_request') {
		const accountMap = new Map((local.accounts || []).map(account => [account.entityHash, account]))
		for (const row of remote)
			for (const account of row.accounts || [])
				accountMap.set(account.entityHash, account)
		merged.accounts = [...accountMap.values()].slice(0, rpc.n || 20)
	}
	if (rpc.type === 'social_post_discover_request') {
		const postMap = new Map((local.posts || []).map(post => [`${post.entityHash}:${post.postId}`, post]))
		for (const row of remote)
			for (const post of row.posts || [])
				postMap.set(`${post.entityHash}:${post.postId}`, post)
		merged.posts = [...postMap.values()].slice(0, rpc.n || 20)
	}
	return merged
}

/**
 * P2P RPC 处理器（供联邦层调用）。
 * @param {string} username 本地用户
 * @param {object} rpc RPC 体
 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站
 * @returns {Promise<object | null>} RPC 响应体
 */
export async function handleSocialRpc(username, rpc, ingress = {}) {
	if (!SOCIAL_RPC_TYPES.has(rpc?.type)) return null
	switch (rpc?.type) {
		case 'social_discover_request':
			return { type: 'social_discover_response', ...await discoverAccounts(username, rpc) }
		case 'social_post_discover_request':
			return { type: 'social_post_discover_response', ...await discoverPosts(username, rpc) }
		case 'social_follow_graph_request':
			return {
				type: 'social_follow_graph_response',
				entityHash: rpc.entityHash,
				following: await discoverFollowGraph(username, String(rpc.entityHash), ingress),
			}
		case 'social_timeline_pull_request': {
			const entityHash = (rpc.entityHash || '').toLowerCase()
			const events = await buildFederatedTimelinePullResponse(
				username,
				entityHash,
				rpc.afterEventId,
				ingress.requesterNodeHash,
			)
			return {
				type: 'social_timeline_pull_response',
				entityHash,
				events,
			}
		}
		case 'social_on_mention': {
			const { processSocialOnMentionRpc } = await import('./dispatch.mjs')
			return {
				type: 'social_on_mention_response',
				...await processSocialOnMentionRpc(username, rpc),
			}
		}
		default:
			return null
	}
}

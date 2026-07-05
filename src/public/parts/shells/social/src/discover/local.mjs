import { getProfile } from '../../../../../../scripts/p2p/entity/profile.mjs'
import { formatHashShort } from '../../../../../../scripts/p2p/entity_id.mjs'
import { listLocalTimelineOwners } from '../feed/helpers.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

/** 遍历 owner 时多采样的倍数，供后续 shuffle 截断以保证随机性。 */
const POST_DISCOVER_SAMPLE_MULTIPLIER = 3

/**
 * 探索页推荐公开账户（跳过受保护时间线）。
 * @param {string} username 用户
 * @param {object} [options] 探索选项
 * @param {number} [options.n=20] 返回账户数
 * @param {string} [options.cursor] 分页游标（entityHash）
 * @param {string | null} [options.nodeHashPrefix] 仅该 nodeHash 托管的 entity；缺省为全部已知 owner
 * @returns {Promise<{ accounts: object[], nextCursor: string | null }>} 推荐账户
 */
export async function discoverAccounts(username, options = {}) {
	const accountLimit = Math.min(Math.max(Number(options.n) || 20, 1), 100)
	const cursor = (options.cursor || '').toLowerCase()
	const nodeHashPrefix = (options.nodeHashPrefix || '').trim().toLowerCase() || null
	const owners = await listLocalTimelineOwners(username, { nodeHashPrefix })
	const start = cursor ? Math.max(0, owners.indexOf(cursor) + 1) : 0
	const slice = owners.slice(start, start + accountLimit)
	/** @type {object[]} */
	const accounts = []
	for (const entityHash of slice) {
		const view = await getTimelineMaterialized(username, entityHash)
		if (view.socialMeta?.hideFromDiscovery) continue
		if (!view.posts?.length && !view.socialMeta?.createdAt) continue
		const profile = await getProfile(entityHash, username)
		accounts.push({
			entityHash,
			name: profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 0, ellipsis: false }),
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

/**
 * @param {string} username 用户
 * @param {object} [options] 探索选项
 * @param {number} [options.n=20] 返回帖子数
 * @param {boolean} [options.mediaOnly=false] 仅含媒体
 * @param {string | null} [options.nodeHashPrefix] 仅该 nodeHash 托管的 entity；缺省为全部已知 owner
 * @returns {Promise<{ posts: object[] }>} 随机帖子样本
 */
export async function discoverPosts(username, options = {}) {
	const postLimit = Math.min(Math.max(Number(options.n) || 20, 1), 100)
	const mediaOnly = Boolean(options.mediaOnly)
	const nodeHashPrefix = (options.nodeHashPrefix || '').trim().toLowerCase() || null
	const owners = await listLocalTimelineOwners(username, { nodeHashPrefix })
	/** @type {object[]} */
	const posts = []

	for (const entityHash of owners) {
		if (posts.length >= postLimit * POST_DISCOVER_SAMPLE_MULTIPLIER) break
		const view = await getTimelineMaterialized(username, entityHash)
		if (view.socialMeta?.hideFromDiscovery) continue
		for (const post of view.posts) {
			if (post.content?.visibility === 'followers') continue
			if (mediaOnly && !post.content?.mediaRefs?.length) continue
			posts.push({
				entityHash,
				postId: post.id,
				textSnippet: (post.content?.text || '').slice(0, 280),
				mediaThumbs: post.content?.mediaRefs?.slice(0, 4) || [],
				hlc: post.hlc,
			})
		}
	}

	for (let index = posts.length - 1; index > 0; index--) {
		const randomIndex = Math.floor(Math.random() * (index + 1))
		;[posts[index], posts[randomIndex]] = [posts[randomIndex], posts[index]]
	}

	return { posts: posts.slice(0, postLimit) }
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
	if (view.socialMeta?.hideFromDiscovery) {
		const { getNodeHash } = await import('../../../../../../scripts/p2p/node/identity.mjs')
		const { resolveOperatorEntityHashForUser } = await import('../../../../../../server/p2p_server/operator_identity.mjs')
		const requesterNode = (ingress.requesterNodeHash || '').trim().toLowerCase()
		const operator = await resolveOperatorEntityHashForUser(username)
		const isOwnerRequest = requesterNode === getNodeHash() || operator?.toLowerCase() === id
		if (!isOwnerRequest) return []
	}
	return view.following
}

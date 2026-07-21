import { socialPostKey } from '../federation/post_key.mjs'
import { maybeDecryptPostContent } from '../vault_crypto/vault.mjs'

/**
 * @param {object | null | undefined} poll poll 配置
 * @param {number} [wallTime=Date.now()] 判定时刻
 * @returns {boolean} 是否已截止
 */
export function isPollClosed(poll, wallTime = Date.now()) {
	if (!poll?.deadline) return false
	const parsed = Date.parse(String(poll.deadline))
	if (!Number.isFinite(parsed)) return false
	return parsed <= wallTime
}

/**
 * @param {object} poll poll 配置
 * @returns {object} 规范化 poll 草稿
 */
export function normalizePollDraft(poll) {
	const options = (poll?.options || []).map(opt => String(opt).trim()).filter(Boolean)
	if (options.length < 2) throw new Error('poll requires at least 2 options')
	if (options.length > 10) throw new Error('poll allows at most 10 options')
	const multi = poll?.multi === true
	let deadline = poll?.deadline ? String(poll.deadline).trim() : null
	if (deadline) {
		const parsed = Date.parse(deadline)
		if (!Number.isFinite(parsed)) throw new Error('invalid poll deadline')
		if (parsed <= Date.now()) throw new Error('poll deadline must be in the future')
	}
	else deadline = null
	return { options, multi, deadline }
}

/**
 * @param {object} poll poll 配置
 * @param {number[]} choices 选项下标
 * @returns {number[]} 合法 choices
 */
export function normalizePollChoices(poll, choices) {
	const indices = [...new Set((choices || []).map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 0))]
	if (!indices.length) throw new Error('choices required')
	const max = poll.options.length - 1
	for (const idx of indices)
		if (idx > max) throw new Error('invalid poll choice')
	if (!poll.multi && indices.length > 1) throw new Error('poll does not allow multiple choices')
	return indices
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} targetPostId 帖 id
 * @returns {Promise<{ post: object, poll: object, content: object }>} 目标帖与 poll
 */
export async function loadPollTargetPost(username, targetEntityHash, targetPostId) {
	const { getTimelineMaterialized } = await import('../timeline/materialize.mjs')
	const owner = targetEntityHash.toLowerCase()
	const view = await getTimelineMaterialized(username, owner)
	const post = view.postById[targetPostId]
	if (!post) throw new Error('post not found')
	const content = await maybeDecryptPostContent(username, owner, post.content)
	const poll = content?.poll
	if (!poll?.options?.length) throw new Error('post has no poll')
	return { post, poll, content }
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} targetPostId 帖 id
 * @param {number[]} choices 选项下标
 * @param {number} [wallTime=Date.now()] 判定时刻
 * @returns {Promise<number[]>} 合法 choices
 */
export async function assertPollVoteAllowed(username, targetEntityHash, targetPostId, choices, wallTime = Date.now()) {
	const { poll } = await loadPollTargetPost(username, targetEntityHash, targetPostId)
	if (isPollClosed(poll, wallTime)) throw new Error('poll closed')
	return normalizePollChoices(poll, choices)
}

/**
 * @param {object} view 物化视图
 * @param {string} targetEntityHash 帖作者
 * @param {string} targetPostId 帖 id
 * @returns {number[] | null} viewer 已选
 */
export function viewerPollChoicesFromView(view, targetEntityHash, targetPostId) {
	const key = socialPostKey(targetEntityHash, targetPostId)
	const row = view.pollVotes?.get?.(key) || view.pollVotes?.[key]
	if (!row?.choices?.length) return null
	return row.choices
}

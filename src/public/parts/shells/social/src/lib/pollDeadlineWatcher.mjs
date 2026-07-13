/**
 * Social poll 截止 watcher（镜像 chat voteDeadlineWatcher 模式）。
 */
import { notifyUser } from '../../../../../../server/web_server/notify/notify.mjs'

import { getReplicaUsernamesProvider } from '../federation/follower_index_registry.mjs'
import { resolveSocialEntity } from '../federation/hosting.mjs'
import { listPollTally, readPollTally } from '../federation/poll_index.mjs'
import { appendPollClosedInboxRow } from '../inbox.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent } from '../vault_crypto/vault.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

import { isPollClosed } from './poll.mjs'

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const scheduledDeadlines = new Map()

/**
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {string}
 */
function scheduleKey(entityHash, postId) {
	return `${entityHash.toLowerCase()}:${postId}`
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {Promise<void>}
 */
export async function firePollClosed(username, entityHash, postId) {
	const owner = entityHash.toLowerCase()
	const view = await getTimelineMaterialized(username, owner)
	const post = view.postById[postId]
	if (!post) return
	const content = await maybeDecryptPostContent(username, owner, post.content)
	const poll = content?.poll
	if (!poll?.options?.length) return
	if (!isPollClosed(poll)) return
	const resolved = await resolveSocialEntity(owner, username)
	if (!resolved?.local || resolved.replicaUsername !== username) return
	const { votes } = await readPollTally(username, owner, postId)
	const tally = await listPollTally(username, owner, postId)
	const recipients = new Set([owner, ...Object.keys(votes)])
	for (const recipient of recipients)
		await appendPollClosedInboxRow(username, recipient, owner, postId, poll, tally)
	const preview = String(content?.text || poll.options[0] || 'poll closed').slice(0, 120)
	void notifyUser(username, {
		title: '投票已结束',
		body: preview,
		url: `/parts/shells:social/#post:${encodeURIComponent(owner)}:${encodeURIComponent(postId)}`,
		tag: `poll-closed:${postId}`,
	})
	pushFeedUpdate(username, { type: 'poll_closed', entityHash: owner, postId, tally })
}

/**
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @returns {Promise<void>}
 */
export async function schedulePollDeadlines(username, entityHash) {
	const owner = entityHash.toLowerCase()
	const view = await getTimelineMaterialized(username, owner)
	for (const post of view.posts || []) {
		const content = await maybeDecryptPostContent(username, owner, post.content)
		const poll = content?.poll
		if (!poll?.deadline) continue
		const parsed = Date.parse(String(poll.deadline))
		if (!Number.isFinite(parsed)) continue
		const key = scheduleKey(owner, post.id)
		if (scheduledDeadlines.has(key)) continue
		if (parsed <= Date.now()) {
			await firePollClosed(username, owner, post.id)
			continue
		}
		const timeout = setTimeout(() => {
			scheduledDeadlines.delete(key)
			void firePollClosed(username, owner, post.id)
		}, parsed - Date.now())
		scheduledDeadlines.set(key, timeout)
	}
}

/**
 * 启动时为本实例全部 replica 的本地 entity 时间线注册 poll deadline。
 * @returns {Promise<void>}
 */
export async function bootstrapPollDeadlineWatchers() {
	const listUsers = getReplicaUsernamesProvider()
	if (!listUsers) return
	const { getTimelineOwnerIndex } = await import('../timeline/ownerIndex.mjs')
	for (const username of listUsers()) {
		const owners = (await getTimelineOwnerIndex(username)).all
		for (const entityHash of owners) {
			const resolved = await resolveSocialEntity(entityHash, username)
			if (!resolved?.local || resolved.replicaUsername !== username) continue
			await schedulePollDeadlines(username, entityHash)
		}
	}
}

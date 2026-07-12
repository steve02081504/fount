/**
 * 投票 ballot 截止与关票通知。
 */
import { notifyUser } from 'fount/server/notify/notify.mjs'

import { readChannelMessagesForUser } from '../../group/queries.mjs'
import { broadcastEvent } from '../ws/groupWsBroadcast.mjs'
import { getState } from '../dag/materialize.mjs'
import {
	appendChatInbox,
	deriveChatInboxVoteClosedRow,
	listLocalRecipientsInGroup,
	resolveAuthorFromSender,
} from './inbox.mjs'
import { resolveOperatorEntityHash } from './replica.mjs'
import { tallyVoteChoices } from './voteTally.mjs'

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const scheduledDeadlines = new Map()

/**
 * @param {string} ballotId ballot eventId
 * @param {string} groupId 群 ID
 * @returns {string}
 */
function scheduleKey(ballotId, groupId) {
	return `${groupId}:${ballotId}`
}

import { isVoteBallotClosed } from './voteBallots.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} ballotId ballot eventId
 * @returns {Promise<void>}
 */
export async function fireVoteClosed(username, groupId, channelId, ballotId) {
	const { state } = await getState(username, groupId)
	const ballot = state.voteBallots?.[ballotId]
	if (!ballot) return
	const lines = await readChannelMessagesForUser(username, groupId, channelId, { limit: 5000 })
	const tallyMap = tallyVoteChoices(lines, ballotId)
	const tally = Object.fromEntries(tallyMap.entries())
	const recipients = new Set(await listLocalRecipientsInGroup(username, state))
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase()
	if (operator) recipients.add(operator)
	const ballotSender = String(ballot.sender || '').trim().toLowerCase()
	const { authorEntityHash } = resolveAuthorFromSender(state, ballotSender)
	if (authorEntityHash) recipients.add(authorEntityHash.toLowerCase())
	const voterKeys = state.messageOverlay?.votes?.get?.(ballotId)
	if (voterKeys)
		for (const voterKey of voterKeys.keys()) {
			const { authorEntityHash: voterHash } = resolveAuthorFromSender(state, voterKey)
			if (voterHash) recipients.add(voterHash.toLowerCase())
		}
	const preview = String(ballot.question || 'vote closed').slice(0, 120)
	const url = `/parts/shells:chat/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)};${encodeURIComponent(ballotId)}`
	for (const recipientHash of recipients) {
		const row = deriveChatInboxVoteClosedRow(recipientHash, groupId, channelId, ballotId, {
			authorEntityHash: authorEntityHash || ballotSender,
			authorDisplayName: ballot.question || 'vote',
			textPreview: preview,
			ballotId,
		})
		await appendChatInbox(username, recipientHash, row)
		if (recipientHash === operator)
			void notifyUser(username, {
				title: '投票已结束',
				body: preview,
				url,
				tag: `vote-closed:${ballotId}`,
			})
	}
	broadcastEvent(groupId, { type: 'vote_closed', channelId, ballotId, tally })
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function scheduleVoteDeadlines(username, groupId) {
	const { state } = await getState(username, groupId)
	for (const [ballotId, ballot] of Object.entries(state.voteBallots || {})) {
		if (!ballot?.deadline) continue
		const parsed = Date.parse(ballot.deadline)
		if (!Number.isFinite(parsed)) continue
		const key = scheduleKey(ballotId, groupId)
		if (scheduledDeadlines.has(key)) continue
		if (parsed <= Date.now()) {
			await fireVoteClosed(username, groupId, ballot.channelId || 'default', ballotId)
			continue
		}
		const timeout = setTimeout(() => {
			scheduledDeadlines.delete(key)
			void fireVoteClosed(username, groupId, ballot.channelId || 'default', ballotId)
		}, parsed - Date.now())
		scheduledDeadlines.set(key, timeout)
	}
}

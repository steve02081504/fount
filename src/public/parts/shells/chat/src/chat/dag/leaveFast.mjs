/**
 * 主动退群快速路径：用 snapshot 校验成员与 DAG tip，避免全量物化与整文件 events 重读。
 */
import { mkdir } from 'node:fs/promises'

import { sortedPrevEventIds } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { nextHlc } from '../../../../../../../scripts/p2p/hlc.mjs'
import { materializeFromCheckpoint } from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { resolveActiveMemberKey } from '../../group/access.mjs'
import { groupDir, snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { appendEvent } from './append.mjs'
import { commitSignedChatEvent } from './commitSignedEvent.mjs'
import { validateIngestAuthz } from './ingest.mjs'
import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState } from './materialize.mjs'
import { signLocalChatEvent } from './signLocalEvent.mjs'

/** 批量退群联邦发布超时（毫秒）。 */
const LEAVE_FEDERATION_JOIN_TIMEOUT_MS = 4000

/**
 * @param {object | null} checkpoint snapshot.json
 * @returns {string[]} 当前 DAG tip event id 列表
 */
function prevTipIdsFromCheckpoint(checkpoint) {
	if (!checkpoint) return []
	const tips = (Array.isArray(checkpoint.dag_tip_ids) ? checkpoint.dag_tip_ids : [])
		.map(t => String(t).trim().toLowerCase())
		.filter(isHex64)
	if (tips.length) return sortedPrevEventIds(tips)
	const anchor = String(checkpoint.checkpoint_event_id || '').trim().toLowerCase()
	return isHex64(anchor) ? [anchor] : []
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<{ username: string, state: object, memberKey: string, sender: string, secretKey: Uint8Array } | null>} 成员上下文；非成员为 null
 */
export async function resolveLeaveMembership(username, groupId) {
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	if (checkpoint?.members_record) {
		const state = materializeFromCheckpoint(checkpoint)
		const memberKey = resolveActiveMemberKey(state, sender)
		if (!memberKey) return null
		return { username, state, memberKey, sender, secretKey }
	}
	const { state } = await getState(username, groupId)
	const memberKey = resolveActiveMemberKey(state, sender)
	if (!memberKey) return null
	return { username, state, memberKey, sender, secretKey }
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {Uint8Array} secretKey 签名种子
 * @returns {object} 退群 commit 选项
 */
function leaveCommitOpts(secretKey, state) {
	return {
		checkpointOwnerSecretKey: secretKey,
		publishFederation: true,
		skipCheckpointRebuild: true,
		federationState: state,
		federationExistingSlotOnly: true,
		federationJoinTimeoutMs: LEAVE_FEDERATION_JOIN_TIMEOUT_MS,
	}
}

/**
 * 追加 `member_leave`（优先 checkpoint tip；无 snapshot 时回退标准 append）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ state: object, sender: string, secretKey: Uint8Array }} ctx 退群上下文
 * @returns {Promise<void>}
 */
export async function appendMemberLeaveFast(username, groupId, ctx) {
	const { state, sender, secretKey } = ctx
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	const prevFromCheckpoint = prevTipIdsFromCheckpoint(checkpoint)
	if (!prevFromCheckpoint.length) {
		await appendEvent(username, groupId, {
			type: 'member_leave',
			sender,
			timestamp: Date.now(),
			content: {},
		}, secretKey, {
			state,
			skipCheckpointRebuild: true,
			skipReleaseQuarantined: true,
			federationExistingSlotOnly: true,
			federationJoinTimeoutMs: LEAVE_FEDERATION_JOIN_TIMEOUT_MS,
		})
		return
	}

	const event = {
		type: 'member_leave',
		sender,
		timestamp: Date.now(),
		content: {},
	}
	await validateIngestAuthz(username, groupId, event, { source: 'local', state })
	await mkdir(groupDir(username, groupId), { recursive: true })

	const { wirePayload } = await signLocalChatEvent({
		username,
		groupId,
		event,
		secretKey,
		state,
		hlc: nextHlc(null, event.timestamp),
		prev_event_ids: prevFromCheckpoint,
	})
	await commitSignedChatEvent(username, groupId, wirePayload, leaveCommitOpts(secretKey, state))
}

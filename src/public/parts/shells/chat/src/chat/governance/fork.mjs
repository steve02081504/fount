/**
 * 【文件】governance/fork.mjs
 * 【职责】治理分叉产品化：从源群选定 DAG 分支尖 fork 出新 groupId，复制 GSH、频道消息视图与信誉快照，写入新群创世 DAG。
 * 【原理】forkGroupFromBranch 读 branchStore tip、ancestor 闭包事件，createGroup 后批量 append 与 init GSH；频道 JSONL 按可达事件复制。新群联邦房间独立，原群 P2P 关系不自动迁移。
 * 【数据结构】返回 { groupId, forkedFrom, branchTip, defaultChannelId }；新群目录 under groups/{newId}。
 * 【关联】branchStore.mjs、file_keys/store、dag/lifecycle、checkpoint、reputation.mjs、paths.mjs。
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { buildCheckpointPayload } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { computeLocalTipsHash } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl, writeJsonAtomic } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { createGroup } from '../dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { groupDir, eventsPath, fileMasterKeysPath, messagesPath, snapshotPath } from '../lib/paths.mjs'

import { saveGovernanceBranchTip } from './branchStore.mjs'

/**
 * @param {string} src 源路径
 * @param {string} dst 目标路径
 * @returns {Promise<void>}
 */
async function cpIfExists(src, dst) {
	try {
		await stat(src)
		await cp(src, dst, { force: true })
	}
	catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
}

/**
 * @param {string} username 用户名
 * @param {string} sourceGroupId 源群 ID
 * @param {{ tipId?: string, name?: string, copyReputation?: boolean }} [opts] 可选分支尖与新群名称
 * @returns {Promise<{ groupId: string, forkedFrom: string, branchTip: string, defaultChannelId: string }>} 新群元数据
 */
export async function forkGroupFromBranch(username, sourceGroupId, opts = {}) {
	const { state, order, events } = await getState(username, sourceGroupId)
	if (!events.length)
		throw new Error('source group has no events')

	const branchTip = opts.tipId?.trim().toLowerCase()
		|| state.consensusBranchTip
		|| order[order.length - 1]
	if (!isHex64(branchTip))
		throw new Error('invalid or missing branch tip for fork')

	const byId = new Map(events.map(event => [event.id, event]))
	if (!byId.has(branchTip))
		throw new Error('branch tip not found in source DAG')

	const forkName = opts.name?.trim() || `${state.groupMeta?.name || sourceGroupId} (fork)`

	const plannedGroupId = randomUUID()
	const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, plannedGroupId)
	const { groupId: forkGroupId, defaultChannelId } = await createGroup(username, {
		groupId: plannedGroupId,
		name: forkName,
		description: state.groupMeta?.description ?? '',
		ownerPubKeyHash,
		secretKey,
	})

	await cpIfExists(fileMasterKeysPath(username, sourceGroupId), fileMasterKeysPath(username, forkGroupId))

	const srcMsgDir = join(groupDir(username, sourceGroupId), 'messages')
	const dstMsgDir = join(groupDir(username, forkGroupId), 'messages')
	await mkdir(dstMsgDir, { recursive: true })
	try {
		await stat(srcMsgDir)
		const files = await readdir(srcMsgDir)
		for (const f of files) {
			if (!f.endsWith('.jsonl')) continue
			const channelId = f.replace(/\.jsonl$/u, '')
			await cp(messagesPath(username, sourceGroupId, channelId), messagesPath(username, forkGroupId, channelId), { force: true })
		}
	}
	catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}

	if (opts.copyReputation !== false) {
		const { reputationPath } = await import('../lib/paths.mjs')
		await cpIfExists(reputationPath(username, sourceGroupId), reputationPath(username, forkGroupId))
	}

	await appendSignedLocalEvent(username, forkGroupId, {
		type: 'group_meta_update',
		timestamp: Date.now(),
		content: {
			forkedFrom: sourceGroupId,
			forkBranchTip: branchTip,
			forkedAt: Date.now(),
		},
	})

	const newEvents = await readJsonl(eventsPath(username, forkGroupId), { sanitize: sanitizeFederatedEvent })
	const last = newEvents[newEvents.length - 1]
	const tips = computeDagTipIdsFromEvents(newEvents)
	const forkState = {
		...state,
		groupId: forkGroupId,
		dagTips: tips,
		consensusBranchTip: branchTip,
		governanceFork: false,
	}
	const pins = Object.fromEntries(forkState.messageOverlay?.pins ?? new Map())
	const fileIdx = Object.fromEntries(forkState.messageOverlay?.fileIndex ?? new Map())
	const checkpointPayload = buildCheckpointPayload({
		local_node_id: null,
		materialized: forkState,
		epoch_id: 1,
		checkpoint_event_id: last?.id || '',
		eventIdsInEpoch: newEvents.map(event => event.id),
		dag_tip_ids: tips,
		local_tips_hash: computeLocalTipsHash(tips),
		overlay: {
			deletedIds: [...forkState.messageOverlay?.deletedIds ?? []],
			editHistory: Object.fromEntries(forkState.messageOverlay?.editHistory ?? []),
			reactions: Object.fromEntries(
				[...forkState.messageOverlay?.reactions ?? new Map()].map(([key, voters]) => [key, [...voters]]),
			),
			pins,
			fileIndex: fileIdx,
		},
		fileFolders: { ...forkState.fileFolders || {} },
	})
	await writeJsonAtomic(snapshotPath(username, forkGroupId), checkpointPayload)
	await saveGovernanceBranchTip(username, forkGroupId, branchTip)

	return {
		groupId: forkGroupId,
		forkedFrom: sourceGroupId,
		branchTip,
		defaultChannelId,
	}
}

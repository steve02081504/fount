/**
 * 【文件】governance/fork.mjs
 * 【职责】消息视图 fork：以 forker 为 owner 创建新群，复制源群频道 JSONL 与 messageOverlay/fileFolders 快照；治理态（成员/角色/频道）不继承。
 * 【原理】校验 branch tip 后 createGroup；整文件复制 messages/*.jsonl 与 file master keys；checkpoint 仅携带 overlay/文件夹。不 replay 源群 DAG ancestor 闭包。新群联邦房间独立。
 * 【数据结构】返回 { groupId, forkedFrom, branchTip, defaultChannelId }；新群目录 under groups/{newId}。
 * 【关联】branchStore.mjs、file_keys/store、dag/lifecycle、checkpoint、paths.mjs。
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { signCheckpoint } from 'npm:@steve02081504/fount-p2p/crypto/checkpoint_sign'
import { computeLocalTipsHash } from 'npm:@steve02081504/fount-p2p/dag/index'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { buildCheckpointPayload } from '../dag/checkpointPayload.mjs'
import { createGroup } from '../dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { groupDir, fileMasterKeysPath, messagesPath, snapshotPath } from '../lib/paths.mjs'

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
 * @param {{ tipId?: string, name?: string, entityHash?: string }} [opts] 可选分支尖、新群名称与签名实体
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

	if (!order.includes(branchTip))
		throw new Error('branch tip not found in source DAG')

	const forkName = opts.name?.trim() || `${state.groupMeta?.name || sourceGroupId} (fork)`
	const entityHash = opts.entityHash

	const plannedGroupId = randomUUID()
	const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, plannedGroupId, entityHash)
	const { groupId: forkGroupId, defaultChannelId } = await createGroup(username, {
		groupId: plannedGroupId,
		name: forkName,
		description: state.groupMeta?.description ?? '',
		ownerPubKeyHash,
		secretKey,
		entityHash,
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

	await appendSignedLocalEvent(username, forkGroupId, {
		type: 'group_meta_update',
		timestamp: Date.now(),
		content: {
			forkedFrom: sourceGroupId,
			forkBranchTip: branchTip,
			forkedAt: Date.now(),
		},
	}, { entityHash })

	// 基于 fork 自身 DAG 物化出的权威状态（forker 即 founder/owner）重建 checkpoint，
	// 仅携带源群消息 overlay 与文件夹，使复制过来的频道消息保留置顶/表态/编辑/删除视图。
	// 切勿用源群 members 覆盖 fork 状态——否则 forker 在新群里不被识别为成员。
	const { state: forkState, events: newEvents, order: forkOrder } = await getState(username, forkGroupId)
	const tips = forkState.dagTips
	const checkpointEventId = forkState.consensusBranchTip && tips.includes(forkState.consensusBranchTip)
		? forkState.consensusBranchTip
		: forkOrder[forkOrder.length - 1] || newEvents[newEvents.length - 1]?.id || ''
	const srcOverlay = state.messageOverlay
	const checkpointPayload = await signCheckpoint(buildCheckpointPayload({
		local_node_id: null,
		materialized: forkState,
		epoch_id: 1,
		checkpoint_event_id: checkpointEventId,
		eventIdsInEpoch: newEvents.map(event => event.id),
		dag_tip_ids: tips,
		local_tips_hash: computeLocalTipsHash(tips),
		overlay: {
			deletedIds: [...srcOverlay?.deletedIds ?? []],
			editHistory: Object.fromEntries(srcOverlay?.editHistory ?? new Map()),
			feedbackHistory: Object.fromEntries(srcOverlay?.feedbackHistory ?? new Map()),
			reactions: Object.fromEntries(
				[...srcOverlay?.reactions ?? new Map()].map(([key, voters]) => [key, [...voters]]),
			),
			pins: Object.fromEntries(srcOverlay?.pins ?? new Map()),
			fileIndex: Object.fromEntries(srcOverlay?.fileIndex ?? new Map()),
		},
		fileFolders: { ...state.fileFolders || {} },
	}), secretKey)
	await writeJsonAtomic(snapshotPath(username, forkGroupId), checkpointPayload)
	await saveGovernanceBranchTip(username, forkGroupId, branchTip)

	return {
		groupId: forkGroupId,
		forkedFrom: sourceGroupId,
		branchTip,
		defaultChannelId,
	}
}

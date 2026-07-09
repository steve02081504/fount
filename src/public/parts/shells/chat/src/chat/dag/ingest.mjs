/**
 * 【文件】`dag/ingest.mjs` — 入站事件鉴权（本地与联邦共用）。
 * 【职责】在 append/远程入库前校验 join 策略、消息索引、权限矩阵、session 形状与 `dag_tip_merge` 前驱合法性。
 * 【原理】先物化当前群状态再判权；联邦路径要求 ACL 快照就绪且 sender 为 pubKeyHash；消息变更类事件走 `assertEventPermission`；`dag_tip_merge` 要求声明 >= 2 个父且所有 `prev_event_ids` 本地已存在（缺父可延迟，跨节点并发合并下不强求等于本地 frontier）。
 * 【数据结构】入参为 DAG 事件对象；`opts.source` 为 `'local' | 'federation'`。
 * 【关联】`authorizeEvent.mjs`、`materialize.mjs`、`sessionEventValidate.mjs`、`../federation/acl.mjs`。
 */
import { sortedPrevEventIds } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { isPubKeyHashBlocked } from '../../../../../../../scripts/p2p/denylist.mjs'
import { assertHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import {
	shouldDeferInboundIngest,
} from '../federation/acl.mjs'
import { validateJoinPolicy } from '../governance/joinPolicy.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { assertEventPermission } from './authorizeEvent.mjs'
import { getState } from './materialize.mjs'
import { validateSessionEventContent } from './sessionEventValidate.mjs'
import { validateWorldOpContent } from './worldOpEventValidate.mjs'
import { PUB_KEY_HASH_HEX } from './validator.mjs'

/**
 * @param {unknown} ref content_ref 对象
 */
function validateContentRefPayload(ref) {
	assertHex64(ref?.contentHash, 'content_ref.contentHash')
	const algorithm = ref?.alg?.trim()
	const byteLength = Number(ref?.byteLength)
	const storageLocator = ref?.storageLocator?.trim()
	if (!algorithm || !Number.isFinite(byteLength) || byteLength < 0 || !storageLocator)
		throw new Error('content_ref requires alg, byteLength, storageLocator')
}

const MESSAGE_MUTATION_TYPES = new Set(['message_edit', 'message_delete', 'message_feedback'])

/**
 * 统一入站鉴权：joinPolicy、消息索引、权限矩阵（本地 append 与联邦落盘共用）。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {object} event 待校验事件
 * @param {{ source?: 'local' | 'federation', state?: object }} [opts] 入站来源；可传入已物化 state 避免重复加载
 * @returns {Promise<void>}
 */
export async function validateIngestAuthz(replicaUsername, groupId, event, opts = {}) {
	const state = opts.state ?? (await getState(replicaUsername, groupId)).state

	if (opts.source === 'federation' && shouldDeferInboundIngest(state, event)) {
		const error = new Error('federated event pending: no ACL snapshot')
		error.pendable = true
		throw error
	}

	if (event.type?.startsWith('session_') || event.type === 'agent_reply_frequency_set') {
		validateSessionEventContent(event)
		return
	}

	if (event.type === 'world_op')
		validateWorldOpContent(event)

	if (event.type === 'member_join')
		await validateJoinPolicy(state, event, replicaUsername, { source: opts.source })

	if (event.type === 'message' && event.content?.content_ref)
		validateContentRefPayload(event.content.content_ref)

	if (MESSAGE_MUTATION_TYPES.has(event.type)) {
		assertHex64(event.content?.targetId, 'targetId')
		const senderHash = event.sender.trim().toLowerCase()
		if (!PUB_KEY_HASH_HEX.test(senderHash)) throw new Error(`${event.type} requires pubKeyHash sender`)
		assertEventPermission(state, event, senderHash)
		return
	}

	if (event.type === 'reputation_reset') {
		const targetPubKeyHash = event.content?.targetPubKeyHash?.trim().toLowerCase() || ''
		if (targetPubKeyHash && isPubKeyHashBlocked(targetPubKeyHash))
			throw new Error('reputation_reset ignored for locally blocked target')
	}

	if (event.type === 'dag_tip_merge') {
		// 合并事件本质是多父汇合：其合法性在于「所有父事件本地已存在」，而非「接收方当前 frontier 恰好等于其 prev」。
		// 旧逻辑要求 prev_event_ids 必须等于本地当前 DAG tips；在多节点并发场景下，各节点独立创建的 tip_merge
		// 会互相「吞掉」对方所引用的 tip（A 的 merge 把 X 变为内部节点，B 的 merge 仍把 X 当 tip 引用），
		// 导致两条 merge 永远互不可入站（no_fork / mismatch），下游事件随之连带 pending，跨节点补齐永久死锁。
		// 改为：结构上要求 >= 2 个父；父事件齐备即可入站（多余的本地 tip 留待后续 merge 收敛）；缺父则可延迟等 catchup 补齐。
		const prev = sortedPrevEventIds(event.prev_event_ids)
		if (prev.length < 2)
			throw new Error('dag_tip_merge: must reference >= 2 prev tips')
		const rows = await readJsonl(eventsPath(replicaUsername, groupId), { sanitize: stripDagEventLocalExtensions })
		const presentIds = new Set(rows.map(row => String(row.id).trim().toLowerCase()))
		const missing = prev.filter(id => !presentIds.has(String(id).trim().toLowerCase()))
		if (missing.length) {
			const error = new Error('dag_tip_merge: prev events not present yet')
			error.pendable = true
			throw error
		}
	}

	const senderHash = event.sender.trim().toLowerCase()
	if (!PUB_KEY_HASH_HEX.test(senderHash)) throw new Error('events require pubKeyHash sender')

	const bootstrapTypes = new Set(['group_meta_update', 'channel_create', 'group_settings_update', 'role_create', 'member_join'])
	if (!Object.values(state.members).some(member => member?.status === 'active') && bootstrapTypes.has(event.type))
		return

	assertEventPermission(state, event, senderHash)
}

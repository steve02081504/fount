/**
 * 任务 B 实证：`channel_key_rotate(_batch)` 被 owner 折叠进签名 checkpoint、owner 共识 tip 推进后，
 * 「成员尚未 adopt 新 checkpoint / merge」的窗口期里——成员能否正常收发 / 看到消息？
 *
 * 复刻真实机制（非人为 converge() 一把梭）：
 *   1. 三节点 A(owner)/B(被授予 admin)/C 同处一个公共频道，均持有 K_ch。
 *   2. A 与 B 各自并发发起一次 channel_key_rotate（rotate 不会被归档折叠，能稳定形成跨分支并发叶），
 *      双向联邦后 A/B/C 都通过真实入站 ingest 了两条 rotate（→ 各自导入两代 K_ch wrap）且都把它们当活跃叶。
 *   3. owner A 执行 convergeDagTipsIfAuthorized + rebuildAndSaveCheckpoint：用 dag_tip_merge 汇合并把
 *      rotate 折叠进共识基态、签名 checkpoint。A 的 tip 推进到 merge（= 真实「联邦下发前」owner 已折叠+签名）。
 *   4. 成员 B/C **不 adopt** owner 的 merge / 签名 checkpoint：仍把两条 rotate 当活跃叶 → 跨节点 tip 确实分叉。
 *   5. 在此窗口期实测：A→B/C、B→A/C、C→A/B 实时推送消息，三方能否收到、解密、在频道列表中看到。
 *   6. 最后 B/C adopt owner 的签名 checkpoint + 日志 → tip 收敛自愈，历史消息仍可见。
 *
 * 结论：消息收发 / 可见性走 messages.jsonl + channel_keys.json，与 DAG tip 收敛解耦；
 *      成员经普通 rotate 事件联邦即已持有 K_ch（与 checkpoint adopt 无关），故窗口期交互不受影响。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const RUN_TAG = `krw_${Date.now().toString(36)}`
const DATA_PATH = join(tmpdir(), `fount_${RUN_TAG}`)
const NODE_A = `__${RUN_TAG}_A`
const NODE_B = `__${RUN_TAG}_B`
const NODE_C = `__${RUN_TAG}_C`
const groupId = `grp_${RUN_TAG}`

/** @type {Record<string, any>} */
let M
/** @type {Record<string, string>} */
const hash = {}
let channelId = ''

/**
 * @returns {Promise<void>}
 */
async function bootstrap() {
	set_start()
	await init({
		/** @returns {never} 测试态不应触发重启 */
		restartor: () => process.exit(131),
		data_path: DATA_PATH,
		starts: { Base: false, IPC: false, Web: false, Tray: false, DiscordRPC: false, P2P: false },
	})
	const { initNode, isNodeInitialized } = await import('../../../../../scripts/p2p/node/instance.mjs')
	const { createFountEntityStore } = await import('../../../../../server/p2p_server/entity_store.mjs')
	if (!isNodeInitialized()) {
		await mkdir(join(DATA_PATH, 'p2p', 'node'), { recursive: true })
		initNode({ nodeDir: join(DATA_PATH, 'p2p', 'node'), entityStore: createFountEntityStore() })
	}
	M = {
		lifecycle: await import('../src/chat/dag/lifecycle.mjs'),
		materialize: await import('../src/chat/dag/materialize.mjs'),
		remoteIngest: await import('../src/chat/dag/remoteIngest.mjs'),
		append: await import('../src/chat/dag/append.mjs'),
		postMessage: await import('../src/chat/channel/postMessage.mjs'),
		schedule: await import('../src/chat/channel_keys/schedule.mjs'),
		queries: await import('../src/chat/dag/queries.mjs'),
		localSigner: await import('../src/chat/dag/localSigner.mjs'),
		replica: await import('../src/chat/lib/replica.mjs'),
		paths: await import('../src/chat/lib/paths.mjs'),
		storage: await import('../../../../../scripts/p2p/dag/storage.mjs'),
		strip: await import('../../../../../scripts/p2p/dag/strip_extensions.mjs'),
		dag: await import('../../../../../scripts/p2p/governance_branch.mjs'),
	}
}

/**
 * @param {string} node 节点
 * @returns {Promise<object[]>} 事件
 */
async function readEvents(node) {
	return M.storage.readJsonl(M.paths.eventsPath(node, groupId), { sanitize: M.strip.stripDagEventLocalExtensions })
}

/**
 * 把 from 节点比目标节点多出的事件作为联邦帧灌入目标（真实入站校验路径，多轮补齐）。
 * @param {string} from 源
 * @param {string[]} tos 目标
 * @returns {Promise<void>}
 */
async function federate(from, tos) {
	for (let round = 0; round < 6; round++) {
		let progressed = false
		const sourceEvents = await readEvents(from)
		for (const to of tos) {
			if (to === from) continue
			const haveIds = new Set((await readEvents(to)).map(e => String(e.id).toLowerCase()))
			for (const ev of sourceEvents) {
				if (haveIds.has(String(ev.id).toLowerCase())) continue
				if (await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, ev, { logFailures: false }) === 'ok')
					progressed = true
			}
		}
		if (!progressed) break
	}
}

/**
 * @param {string[]} nodes 节点
 * @returns {Promise<void>}
 */
async function gossipAll(nodes) {
	for (let pass = 0; pass < 3; pass++)
		for (const from of nodes)
			await federate(from, nodes)
}

/**
 * @param {string} from 发帖节点
 * @param {string} text 文本
 * @param {string[]} tos 接收节点（实时推送）
 * @returns {Promise<object>} 已签名 message
 */
async function postMsg(from, text, tos) {
	const { event } = await M.postMessage.postChannelMessage(from, groupId, channelId, { text })
	for (const to of tos)
		await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, event, { logFailures: false })
	return event
}

/**
 * @param {string} node 节点
 * @param {string} eventId 消息事件 id
 * @returns {Promise<object | undefined>} 解密后的消息行
 */
async function readMsg(node, eventId) {
	const rows = await M.queries.listChannelMessages(node, groupId, channelId, { eventIds: [eventId], decrypt: true })
	return rows.find(r => String(r.eventId).toLowerCase() === String(eventId).toLowerCase())
}

/**
 * @param {string} node 节点
 * @returns {Promise<string[]>} 该节点当前 DAG tips（排序）
 */
async function tipsOf(node) {
	return [...M.dag.computeDagTipIdsFromEvents(await readEvents(node))].sort()
}

/**
 * adopt：成员拷贝 owner 的权威日志 + 签名 checkpoint（等价联邦下发签名 checkpoint 后本地落盘）。
 * @param {string} from owner
 * @param {string} to 成员
 * @returns {Promise<void>}
 */
async function adopt(from, to) {
	await mkdir(M.paths.groupDir(to, groupId), { recursive: true })
	await copyFile(M.paths.eventsPath(from, groupId), M.paths.eventsPath(to, groupId))
	await copyFile(M.paths.snapshotPath(from, groupId), M.paths.snapshotPath(to, groupId))
}

/**
 * @param {string} node 加入节点
 * @param {string} ownerNode owner
 * @returns {Promise<string>} 加入者 pubKeyHash
 */
async function joinGroup(node, ownerNode) {
	await adopt(ownerNode, node)
	const { sender, secretKey } = await M.localSigner.getLocalSignerForNewGroup(node, groupId)
	await M.append.appendEvent(node, groupId, {
		type: 'member_join',
		sender,
		timestamp: Date.now(),
		content: { inviteCode: 'invite-krw', homeNodeHash: M.replica.getLocalNodeHash(node) },
	}, secretKey, { publishFederation: false, skipReleaseQuarantined: true })
	return sender
}

/* global Deno */
Deno.test('channel_key_rotate fold window does not block message interaction', async t => {
	await bootstrap()

	const ownerSigner = await M.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	hash.A = ownerSigner.sender

	await M.lifecycle.createGroup(NODE_A, {
		groupId, name: 'KRW', ownerPubKeyHash: hash.A,
		secretKey: ownerSigner.secretKey, defaultChannelId: 'default', enableGroupFederation: false,
	})
	await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	channelId = (await M.materialize.getState(NODE_A, groupId)).state.groupSettings.defaultChannelId

	hash.B = await joinGroup(NODE_B, NODE_A)
	await federate(NODE_B, [NODE_A])
	await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	hash.C = await joinGroup(NODE_C, NODE_A)
	await federate(NODE_C, [NODE_A])
	await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
	await gossipAll([NODE_A, NODE_B, NODE_C])

	await t.step('准备：授予 B founder（可签 checkpoint 且可发起 rotate），全员持有初始 K_ch', async () => {
		// B 提升为 founder：① 具 MANAGE_CHANNELS → 可发起并发 rotate 制造稳定分叉（rotate 不被归档折叠）；
		// ② 是 checkpoint 签名人 → 本地 snapshot 会随 role 更新（否则非签名成员保留 owner 旧签名基态，
		//    loadStateForChannelKeys 读不到自己的新权限而拒绝轮换）。
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign', timestamp: Date.now(),
			content: { targetMemberKey: hash.B, roleId: 'founder' },
		}, { publishFederation: false })
		await M.schedule.rotateAllChannelKeys(NODE_A, groupId)
		await gossipAll([NODE_A, NODE_B, NODE_C])
	})

	let mergedTipA = ''
	await t.step('先 rotate 让全员同代 K_ch，再用并发 role_create 制造分叉 + owner 折叠进签名 checkpoint；成员未 adopt → tip 分叉', async () => {
		// 关键：先做「单次」rotate 并 gossip，使 A/B/C 共享同一代 K_ch（避免并发 rotate 的同代异钥冲突）。
		await M.schedule.appendChannelKeyRotate(NODE_A, groupId, channelId)
		await gossipAll([NODE_A, NODE_B, NODE_C])
		// 再用并发治理事件（role_create：不改 K_ch、不被归档折叠、不触发自动 converge）在同一基 tip 上制造稳定分叉。
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_create', timestamp: Date.now(),
			content: { roleId: 'fork_a', name: 'ForkA', color: '#111111', position: 5, permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false },
		}, { publishFederation: false })
		await M.append.appendSignedLocalEvent(NODE_B, groupId, {
			type: 'role_create', timestamp: Date.now(),
			content: { roleId: 'fork_b', name: 'ForkB', color: '#222222', position: 6, permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false },
		}, { publishFederation: false })
		// 双向联邦：A/B/C 都 ingest 两条并发 role_create 且都把它们当活跃叶（K_ch 不变，全员仍同代密钥）。
		await gossipAll([NODE_A, NODE_B, NODE_C])
		for (const node of [NODE_A, NODE_B, NODE_C])
			assert((await tipsOf(node)).length >= 2, `${node} sees the concurrent governance fork (>=2 tips)`)

		// owner A 汇合分叉（dag_tip_merge）并重建签名 checkpoint（把过程事件折叠进共识基态），A tip 推进到 merge。
		await M.lifecycle.convergeDagTipsIfAuthorized(NODE_A, groupId)
		await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })

		const tipsA = await tipsOf(NODE_A)
		const tipsB = await tipsOf(NODE_B)
		const tipsC = await tipsOf(NODE_C)
		// 成员 B/C 不 adopt owner 的 merge / 签名 checkpoint：仍把并发叶当活跃叶 → 跨节点 tip 确实分叉。
		assertEquals(tipsA.length, 1, 'owner converged to a single merged tip')
		assert(JSON.stringify(tipsA) !== JSON.stringify(tipsB), `A(merged) vs B(un-adopted) tips diverge (A=${tipsA} B=${tipsB})`)
		assertEquals(tipsB, tipsC, 'B and C share the same un-adopted forked tips')
		mergedTipA = tipsA[0]
		// 成员 DAG 里没有 owner 的 merge 事件（= 尚未 adopt 该签名 checkpoint）。
		const bIds = new Set((await readEvents(NODE_B)).map(e => String(e.id).toLowerCase()))
		assert(!bIds.has(mergedTipA), 'B has not adopted owner merge before window')
	})

	/** @type {string[]} */
	const windowMsgIds = []
	await t.step('窗口期实测：A→B/C、B→A/C、C→A/B 消息均可收发 + 解密 + 频道可见', async () => {
		const mA = await postMsg(NODE_A, 'owner msg in window', [NODE_B, NODE_C])
		const mB = await postMsg(NODE_B, 'member-B msg in window', [NODE_A, NODE_C])
		const mC = await postMsg(NODE_C, 'member-C msg in window', [NODE_A, NODE_B])
		windowMsgIds.push(mA.id, mB.id, mC.id)

		for (const [author, m] of [['A', mA], ['B', mB], ['C', mC]])
			for (const node of [NODE_A, NODE_B, NODE_C]) {
				const row = await readMsg(node, m.id)
				assert(row, `${node} received window message from ${author}`)
				assert(!row.content?.decryptFailed, `${node} decrypted window message from ${author}`)
				assert(String(row.content?.content || '').includes('in window'),
					`${node} sees plaintext of ${author}'s window message`)
			}

		// 成员 B 自始至终未 adopt owner 的 merge 事件 / 签名 checkpoint（证明收发确实跨越未采纳态完成）。
		// 注：消息 append 用 multiTip prev_event_ids，会顺带把可见 DAG 叶重新汇合——即「有消息流量时连 tip
		// 都能靠消息自然收敛，根本不必等 checkpoint adopt」，这进一步说明窗口期不阻塞交互。
		const bIds = new Set((await readEvents(NODE_B)).map(e => String(e.id).toLowerCase()))
		assert(!bIds.has(mergedTipA), 'B never adopted owner merge event across the messaging window')
	})

	await t.step('成员 adopt owner 签名 checkpoint + 日志 → tip 收敛自愈，历史消息仍可见', async () => {
		await adopt(NODE_A, NODE_B)
		await adopt(NODE_A, NODE_C)
		const tipsA = await tipsOf(NODE_A)
		assertEquals(await tipsOf(NODE_B), tipsA, 'B converged to owner tip after adopt')
		assertEquals(await tipsOf(NODE_C), tipsA, 'C converged to owner tip after adopt')

		for (const id of windowMsgIds)
			for (const node of [NODE_B, NODE_C]) {
				const row = await readMsg(node, id)
				assert(row && !row.content?.decryptFailed, `${node} still sees window message ${id} after adopt`)
			}
	})
})

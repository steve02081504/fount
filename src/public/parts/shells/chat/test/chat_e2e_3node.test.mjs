/**
 * 新版 chat 后端 3 节点真实端到端联邦流程测试（Deno）。
 *
 * 设计：在单进程内用 3 个独立 fount 用户（= 3 个 nodeHash + 3 套独立 DAG 磁盘副本）模拟
 * 节点 A/B/C。事件经各自本地签名后，以「已签名 wire 帧」通过真实联邦入站路径
 * `appendValidatedRemoteEvent` 在节点间传播（等价于 MQTT/Trystero relay 收到帧后的处理），
 * 因此走的是真实的签名校验 / ACL 快照门控 / joinPolicy / 权限矩阵 / reducer 物化管线，
 * 而非纯单进程 mock。
 *
 * 真实 MQTT relay 在离线 CI 下不可用，因此用「直接注入已签名帧」替换 relay 传输介质本身；
 * 帧的产生（本地签名）与帧的消费（联邦入站校验）均为生产代码路径。
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const RUN_TAG = `e2e_${Date.now().toString(36)}`
const DATA_PATH = join(tmpdir(), `fount_${RUN_TAG}`)

const NODE_A = `__${RUN_TAG}_A`
const NODE_B = `__${RUN_TAG}_B`
const NODE_C = `__${RUN_TAG}_C`

/** @type {Record<string, any>} */
let M

/**
 * headless 启动 fount（仅设置 data_path + config，不起 Web/IPC/Tray）。
 * @returns {Promise<void>}
 */
async function bootstrap() {
	set_start()
	await init({
		/** @returns {never} 测试态不应触发重启 */
		restartor: () => process.exit(131),
		data_path: DATA_PATH,
		starts: { Base: false, IPC: false, Web: false, Tray: false, DiscordRPC: false },
	})
	M = {
		lifecycle: await import('../src/chat/dag/lifecycle.mjs'),
		materialize: await import('../src/chat/dag/materialize.mjs'),
		remoteIngest: await import('../src/chat/dag/remoteIngest.mjs'),
		append: await import('../src/chat/dag/append.mjs'),
		channelOps: await import('../src/chat/dag/channelOps.mjs'),
		postMessage: await import('../src/chat/channel/postMessage.mjs'),
		schedule: await import('../src/chat/channel_keys/schedule.mjs'),
		ckg: await import('../src/chat/channel_keys/content.mjs'),
		queries: await import('../src/chat/dag/queries.mjs'),
		localSigner: await import('../src/chat/dag/localSigner.mjs'),
		replica: await import('../src/chat/lib/replica.mjs'),
		authorize: await import('../src/chat/dag/authorizeEvent.mjs'),
		paths: await import('../src/chat/lib/paths.mjs'),
		utils: await import('../src/chat/lib/utils.mjs'),
		storage: await import('../../../../../scripts/p2p/dag/storage.mjs'),
		strip: await import('../../../../../scripts/p2p/dag/strip_extensions.mjs'),
		state: await import('../../../../../scripts/p2p/materialized_state.mjs'),
		perms: await import('../../../../../scripts/p2p/permissions.mjs'),
	}
}

/**
 * 读取某节点某群的全部已落盘 wire 事件。
 * @param {string} node 节点
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} 事件列表
 */
async function readEvents(node, groupId) {
	return M.storage.readJsonl(M.paths.eventsPath(node, groupId), { sanitize: M.strip.stripDagEventLocalExtensions })
}

/**
 * 把 from 节点比目标节点多出的事件作为联邦帧灌入目标节点（真实入站校验路径）。
 * 多轮重试：member_join 先建立 ACL 快照，后续 gated 事件在下一轮才能过门控；
 * quarantine（父/目标尚未到达）亦在后续轮补齐。
 * @param {string} from 源节点
 * @param {string[]} tos 目标节点
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function federate(from, tos, groupId) {
	for (let round = 0; round < 6; round++) {
		let progressed = false
		const sourceEvents = await readEvents(from, groupId)
		for (const to of tos) {
			if (to === from) continue
			const haveIds = new Set((await readEvents(to, groupId)).map(e => String(e.id).toLowerCase()))
			for (const ev of sourceEvents) {
				if (haveIds.has(String(ev.id).toLowerCase())) continue
				const res = await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, ev, { logFailures: false })
				if (res === 'ok') progressed = true
			}
		}
		if (!progressed) break
	}
}

/**
 * 全节点两两收敛（任意节点的新事件传播到其余节点，反复直到稳定）。
 * @param {string[]} nodes 节点列表
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function gossipAll(nodes, groupId) {
	for (let pass = 0; pass < 3; pass++)
		for (const from of nodes)
			await federate(from, nodes, groupId)
}

/**
 * DAG 叶 id（未被任何事件引用的事件）。
 * @param {object[]} events 事件
 * @returns {string[]} 叶 id 列表
 */
function dagTips(events) {
	const refed = new Set()
	for (const e of events) for (const p of e.prev_event_ids || []) refed.add(String(p).toLowerCase())
	return events.filter(e => !refed.has(String(e.id).toLowerCase())).map(e => String(e.id).toLowerCase())
}

/**
 * 全节点收敛到单一共识叶：反复 gossip + 由 authority 节点发 dag_tip_merge 汇合分叉
 * （等价生产路径 convergeDagTipsIfAuthorized），直至所有节点单叶。
 * 频道密钥轮换/发帖等会产生并发叶，不汇合则非共识支上的治理事件不会被物化（§0 多父汇合）。
 * @param {string[]} nodes 节点列表
 * @param {string} authority 有 dag_tip_merge 权限的治理节点
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function converge(nodes, authority, groupId) {
	const others = nodes.filter(n => n !== authority)
	// 1. 成员把本地新事件上送 authority（owner 视为真相源，先收齐全网增量）。
	for (const n of others) await federate(n, [authority], groupId)
	// 2. authority 汇合自身分叉并重建「签名 checkpoint」——把 channel_key_rotate 等可折叠过程事件
	//    折叠进基态。这一步会把这些事件移出 authority 的 events.jsonl。
	await M.lifecycle.convergeDagTipsIfAuthorized(authority, groupId)
	await M.materialize.rebuildAndSaveCheckpoint(authority, groupId)
	// 3. 成员「采纳」authority 的权威日志 + 签名 checkpoint（等价联邦下发签名 checkpoint 后的本地 adopt）。
	//    若不采纳，成员仍把已被 owner 折叠的过程事件当作活跃 DAG 叶，跨节点 dag_tip_merge 永远无法收敛。
	for (const n of others) await deliverJoinSnapshot(authority, n, groupId)
}

/**
 * 发帖并以「实时联邦推送」方式立即把已签名 message 帧注入对端（等价于 relay 即时下发）。
 * message 事件随后会被折叠出 events.jsonl 进入 messages.jsonl/归档，因此不能依赖事后扫文件传播。
 * @param {string} from 发帖节点
 * @param {string} channelId 频道 ID
 * @param {string} text 文本
 * @param {string[]} tos 接收节点
 * @returns {Promise<object>} 已签名 message 事件
 */
async function postMsg(from, channelId, text, tos) {
	const { event } = await M.postMessage.postChannelMessage(from, groupId, channelId, { text })
	for (const to of tos)
		await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, event, { logFailures: false })
	return event
}

/**
 * 取某频道某 eventId 的消息行（已尝试解密）。
 * @param {string} node 节点
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息事件 id
 * @returns {Promise<object | undefined>} 消息行
 */
async function channelMessage(node, channelId, eventId) {
	const rows = await M.queries.listChannelMessages(node, groupId, channelId, { eventIds: [eventId], decrypt: true })
	return rows.find(r => String(r.eventId).toLowerCase() === String(eventId).toLowerCase())
}

/**
 * 节点本地物化状态。
 * @param {string} node 节点
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 物化状态
 */
async function stateOf(node, groupId) {
	return (await M.materialize.getState(node, groupId)).state
}

/**
 * 活跃成员 pubKeyHash 集合。
 * @param {object} state 物化状态
 * @returns {Set<string>} 活跃成员键
 */
function activeMembers(state) {
	return new Set(Object.entries(state.members).filter(([, m]) => m?.status === 'active').map(([k]) => k))
}

/**
 * 模拟「收到 join 快照」：把源节点的已签名 checkpoint + 事件历史持久化到加入节点磁盘。
 * 不复制 local_signer_seed / channel_keys（加入者使用自身独立身份与密钥）。
 * 真实联邦中这是 join handshake 经 HPKE 下发的 checkpoint + events 落盘后的状态。
 * @param {string} from 源节点
 * @param {string} to 加入节点
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function deliverJoinSnapshot(from, to, groupId) {
	await mkdir(M.paths.groupDir(to, groupId), { recursive: true })
	await copyFile(M.paths.eventsPath(from, groupId), M.paths.eventsPath(to, groupId))
	await copyFile(M.paths.snapshotPath(from, groupId), M.paths.snapshotPath(to, groupId))
}

/**
 * 节点以自身签名身份加入群（先收到 join 快照，再追加自己的 member_join）。
 * @param {string} node 加入节点
 * @param {string} groupId 群 ID
 * @param {string} ownerNode 已持有群历史/已签名 checkpoint 的源节点
 * @param {string} inviteCode 邀请码（invite-only 策略需要）
 * @returns {Promise<string>} 加入者 pubKeyHash
 */
async function joinGroup(node, groupId, ownerNode, inviteCode) {
	await deliverJoinSnapshot(ownerNode, node, groupId)
	const { sender, secretKey } = await M.localSigner.getLocalSignerForNewGroup(node, groupId)
	await M.append.appendEvent(node, groupId, {
		type: 'member_join',
		sender,
		timestamp: Date.now(),
		content: { inviteCode, homeNodeHash: M.replica.getLocalNodeHash(node) },
	}, secretKey, { publishFederation: false, skipReleaseQuarantined: true })
	return sender
}

const groupId = `grp_${RUN_TAG}`
/** @type {Record<string, string>} */
const hash = {}
let publicChannelId = ''
const PRIVATE_CHANNEL = 'secret'

/* global Deno */
Deno.test('chat 3-node E2E', async t => {
	await bootstrap()

	const ownerSigner = await M.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	hash.A = ownerSigner.sender

	await t.step('step1: 节点A 建群 (owner=A)', async () => {
		await M.lifecycle.createGroup(NODE_A, {
			groupId,
			name: 'E2E Group',
			ownerPubKeyHash: hash.A,
			secretKey: ownerSigner.secretKey,
			defaultChannelId: 'default',
			enableGroupFederation: false,
		})
		await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		const state = await stateOf(NODE_A, groupId)
		assertEquals(state.members[hash.A]?.status, 'active')
		assert(state.members[hash.A]?.roles.includes('founder'), 'owner has founder role')
		publicChannelId = state.groupSettings.defaultChannelId
		assert(!!publicChannelId, 'default channel exists')
	})

	await t.step('step2: 建频道 (公共频道 general + 私密频道 secret)', async () => {
		await M.channelOps.createChannel(NODE_A, groupId, {
			channelId: 'general', type: 'text', name: 'General', isPrivate: false,
		})
		await M.channelOps.createChannel(NODE_A, groupId, {
			channelId: PRIVATE_CHANNEL, type: 'text', name: 'Secret', isPrivate: true,
		})
		const state = await stateOf(NODE_A, groupId)
		assert(state.channels.general, 'general channel created')
		assert(state.channels[PRIVATE_CHANNEL]?.isPrivate, 'secret channel is private')
	})

	await t.step('step3: 节点B、C 加入群', async () => {
		// B 加入并同步回 A，A 重建签名 checkpoint（tip 推进到 B_join，保持 DAG 线性）。
		hash.B = await joinGroup(NODE_B, groupId, NODE_A, 'invite-e2e')
		await federate(NODE_B, [NODE_A], groupId)
		await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		// C 从 A 的最新快照（已含 B）加入，C_join 链在 B_join 之后。
		hash.C = await joinGroup(NODE_C, groupId, NODE_A, 'invite-e2e')
		await federate(NODE_C, [NODE_A], groupId)
		await M.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)

		for (const node of [NODE_A, NODE_B, NODE_C]) {
			const members = activeMembers(await stateOf(node, groupId))
			assert(members.has(hash.A) && members.has(hash.B) && members.has(hash.C),
				`${node} sees all 3 active members (got ${members.size})`)
		}
		for (const node of [NODE_A, NODE_B, NODE_C]) {
			const chans = Object.keys((await stateOf(node, groupId)).channels)
			assert(chans.includes('general') && chans.includes(PRIVATE_CHANNEL),
				`${node} retains general+secret channels (got ${chans})`)
		}
	})

	await t.step('step4: 修改身份组/角色设置并验证生效', async () => {
		// 新建 moderator 角色（含 KICK_MEMBERS），授予 B，验证 B 物化权限随之变更。
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_create',
			timestamp: Date.now(),
			content: {
				roleId: 'moderator', name: 'Moderator', color: '#3498db', position: 50,
				permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true, KICK_MEMBERS: true, MANAGE_MESSAGES: true },
				isDefault: false, isHoisted: true,
			},
		}, { publishFederation: false })

		const beforeKick = M.state.memberChannelPermissions(await stateOf(NODE_A, groupId), hash.B, publicChannelId)
		assertEquals(beforeKick[M.perms.PERMISSIONS.KICK_MEMBERS], false)

		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign',
			timestamp: Date.now(),
			content: { targetMemberKey: hash.B, roleId: 'moderator' },
		}, { publishFederation: false })
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)

		for (const node of [NODE_A, NODE_B, NODE_C]) {
			const perms = M.state.memberChannelPermissions(await stateOf(node, groupId), hash.B, publicChannelId)
			assertEquals(perms[M.perms.PERMISSIONS.KICK_MEMBERS], true, `${node}: B gained KICK_MEMBERS`)
		}
	})

	await t.step('step5: 多频道发帖并验证联邦同步到 B/C', async () => {
		// B/C 加入后旋转所有频道密钥，使其拿到 K_ch wrap（VIEW_CHANNEL 成员）。
		await M.schedule.rotateAllChannelKeys(NODE_A, groupId)
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId)

		// 串行发帖 + 实时推送：每条帖即时下发给对端，保持 DAG 线性（避免并发分叉污染后续治理收敛）。
		const m1 = await postMsg(NODE_A, publicChannelId, 'hello default from A', [NODE_B, NODE_C])
		const m2 = await postMsg(NODE_A, 'general', 'hello general from A', [NODE_B, NODE_C])
		// B 在公共频道发帖（验证非 owner 节点亦可发帖并反向同步到 A/C）。
		const m3 = await postMsg(NODE_B, publicChannelId, 'hi default from B', [NODE_A, NODE_C])

		// B/C 收到 A 两条多频道消息且可解密（真正可读）。
		for (const node of [NODE_B, NODE_C]) {
			const r1 = await channelMessage(node, publicChannelId, m1.id)
			const r2 = await channelMessage(node, 'general', m2.id)
			assert(r1 && r1.content?.content?.includes('hello default from A'), `${node} reads A's default message`)
			assert(r2 && r2.content?.content?.includes('hello general from A'), `${node} reads A's general message`)
		}
		// A、C 收到 B 的公共频道消息且可解密。
		for (const node of [NODE_A, NODE_C]) {
			const r3 = await channelMessage(node, publicChannelId, m3.id)
			assert(r3 && r3.content?.content?.includes('hi default from B'), `${node} reads B's message`)
		}
	})

	await t.step('step6: 私密频道细粒度写门控（授权角色+owner 可发，未授权与硬禁言不可发）', async () => {
		// 细粒度权限（Discord 式分层求值 + ADMIN 旁路）：
		//   私密频道对 @everyone 同时 deny VIEW_CHANNEL + SEND_MESSAGES；对 moderator 角色 allow 二者
		//   （B 在 step4 已获 moderator）。求值优先级：全局基线 < 频道 @everyone 覆写 < 频道角色覆写。
		// 期望：owner A（admin）旁路一切 → 可见可发；B（moderator allow 覆盖 @everyone deny）→ 可见可发；
		//       C（仅 @everyone）→ 不可见不可发。
		const P = M.perms.PERMISSIONS
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'channel_permissions_update',
			timestamp: Date.now(),
			content: {
				channelId: PRIVATE_CHANNEL,
				roleId: '@everyone',
				allow: {},
				deny: { VIEW_CHANNEL: true, SEND_MESSAGES: true },
			},
		}, { publishFederation: false })
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'channel_permissions_update',
			timestamp: Date.now(),
			content: {
				channelId: PRIVATE_CHANNEL,
				roleId: 'moderator',
				allow: { VIEW_CHANNEL: true, SEND_MESSAGES: true },
				deny: {},
			},
		}, { publishFederation: false })
		// 轮换私密频道密钥（最新一代 wrap 覆盖授权 viewer：A、B），并把该 rotate 帧以「实时推送」灌入 B/C：
		// 仅授权 viewer B 的 wrap 在帧内 → B 经真实入站路径导入新一代 K_ch；C 无 wrap → 无法导入。
		// （converge 的 adopt 是文件拷贝，不触发 wrap 导入；故须在 adopt 前用真实入站把密钥下发给 B。）
		const rot = await M.schedule.appendChannelKeyRotate(NODE_A, groupId, PRIVATE_CHANNEL)
		for (const to of [NODE_B, NODE_C])
			await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, rot, { logFailures: false })
		await converge([NODE_A, NODE_B, NODE_C], NODE_A, groupId)

		// 权限矩阵：A（admin 旁路）、B（moderator allow 覆盖 @everyone deny）可见可发；C 皆否。
		const aPerms = M.state.memberChannelPermissions(await stateOf(NODE_A, groupId), hash.A, PRIVATE_CHANNEL)
		const bPerms = M.state.memberChannelPermissions(await stateOf(NODE_B, groupId), hash.B, PRIVATE_CHANNEL)
		const cPerms = M.state.memberChannelPermissions(await stateOf(NODE_C, groupId), hash.C, PRIVATE_CHANNEL)
		assertEquals(aPerms[P.VIEW_CHANNEL], true, 'A(owner/admin) can view private channel')
		assertEquals(aPerms[P.SEND_MESSAGES], true, 'A(owner/admin) can send to private channel')
		assertEquals(bPerms[P.VIEW_CHANNEL], true, 'B(moderator allow) can view private channel')
		assertEquals(bPerms[P.SEND_MESSAGES], true, 'B(moderator allow) can send to private channel')
		assertEquals(cPerms[P.VIEW_CHANNEL], false, 'C(@everyone) cannot view private channel')
		assertEquals(cPerms[P.SEND_MESSAGES], false, 'C(@everyone) cannot send to private channel')

		// owner A 发帖：授权读者 A、B 解密成功；未授权 C 收到帧但无 live K_ch → 解密失败。
		const secretA = await postMsg(NODE_A, PRIVATE_CHANNEL, 'top secret from owner', [NODE_B, NODE_C])
		const aReadA = await channelMessage(NODE_A, PRIVATE_CHANNEL, secretA.id)
		const bReadA = await channelMessage(NODE_B, PRIVATE_CHANNEL, secretA.id)
		assert(aReadA?.content?.content?.includes('top secret from owner'), 'A reads own private message')
		assert(bReadA?.content?.content?.includes('top secret from owner'), 'B(authorized role) decrypts private message')
		const cReadA = await channelMessage(NODE_C, PRIVATE_CHANNEL, secretA.id)
		assert(cReadA, 'C received the private message frame (federated)')
		assertEquals(cReadA.content?.decryptFailed, true, 'C(unauthorized) cannot decrypt private message')

		// 授权非 owner（B）发帖：A 解密成功，C 不可——证明「仅授权角色」可发帖，而非仅 owner。
		const secretB = await postMsg(NODE_B, PRIVATE_CHANNEL, 'secret reply from moderator', [NODE_A, NODE_C])
		const aReadB = await channelMessage(NODE_A, PRIVATE_CHANNEL, secretB.id)
		assert(aReadB?.content?.content?.includes('secret reply from moderator'), 'A decrypts B(authorized) private message')
		const cReadB = await channelMessage(NODE_C, PRIVATE_CHANNEL, secretB.id)
		assertEquals(cReadB?.content?.decryptFailed, true, 'C still cannot decrypt B private message')

		// 未授权写门控（DAG authz 层真断）：C 向私密频道发帖被 SEND_MESSAGES 拒绝。
		await assertRejects(
			() => M.postMessage.postChannelMessage(NODE_C, groupId, PRIVATE_CHANNEL, { text: 'C must not send' }),
			Error,
		)

		// 不可翻案的硬禁言（user 级 ban）：被 ban 的成员即便持有授予 SEND 的角色、即便频道再 allow，也一律不可发帖。
		// 基于真实 memberChannelPermissions / checkEventPermission 求值（status≠active 先于一切覆写返回全 false）。
		const liveState = await stateOf(NODE_A, groupId)
		assertEquals(
			M.state.memberChannelPermissions(liveState, hash.B, 'general')[P.SEND_MESSAGES], true,
			'B with moderator role can send before mute',
		)
		const mutedState = structuredClone(liveState)
		mutedState.members[hash.B].status = 'banned'
		// 即便在 general 上为 moderator 显式 allow SEND，硬禁言仍不可被任何 allow / ADMIN 旁路翻案。
		mutedState.channelPermissions.general = {
			moderator: { allow: { SEND_MESSAGES: true, VIEW_CHANNEL: true }, deny: {} },
		}
		const mutedPerms = M.state.memberChannelPermissions(mutedState, hash.B, 'general')
		assertEquals(mutedPerms[P.SEND_MESSAGES], false, 'hard-muted member cannot send despite SEND-granting role + channel allow')
		assertEquals(mutedPerms[P.VIEW_CHANNEL], false, 'hard-muted member retains no channel permission')
		const mutedAuthz = M.authorize.checkEventPermission(mutedState, { type: 'message', channelId: 'general' }, hash.B)
		assertEquals(mutedAuthz.ok, false, 'DAG authz rejects message from hard-muted member')
	})

	await t.step('step7: 群主退群 + owner 交接', async () => {
		// 交接前先把 B 提升为 founder（具备 MANAGE_ADMINS，方可成为委托 owner）。
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign',
			timestamp: Date.now(),
			content: { targetMemberKey: hash.B, roleId: 'founder' },
		}, { publishFederation: false })
		// owner 设置委托交接给 B。
		await M.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { delegatedOwnerPubKeyHash: hash.B },
		}, { publishFederation: false })
		// 把交接相关治理事件传播并收敛（A 仍在群内，由 A 充当 merge 权限节点）。
		await converge([NODE_A, NODE_B, NODE_C], NODE_A, groupId)

		// A 退群（member_leave）。appendEvent 会在 checkpoint 重建时触发 A 本地副本自毁
		// （maybePurgeLocalReplicaIfLeft），故必须 skipCheckpointRebuild 拿到已签名帧后「实时推送」给 B、C，
		// 不能依赖事后扫描 A 的 events.jsonl（彼时可能已被清空）。
		const leaveA = await M.append.appendEvent(NODE_A, groupId, {
			type: 'member_leave', sender: hash.A, timestamp: Date.now(), content: {},
		}, ownerSigner.secretKey, { publishFederation: false, skipReleaseQuarantined: true, skipCheckpointRebuild: true })
		for (const to of [NODE_B, NODE_C])
			await M.remoteIngest.appendValidatedRemoteEvent(to, groupId, leaveA, { logFailures: false })

		// 交接后 B 应能行使治理权（创建角色），证明治理可用。
		await M.append.appendSignedLocalEvent(NODE_B, groupId, {
			type: 'role_create',
			timestamp: Date.now(),
			content: {
				roleId: 'post-handoff', name: 'PostHandoff', color: '#1abc9c', position: 10,
				permissions: { VIEW_CHANNEL: true }, isDefault: false, isHoisted: false,
			},
		}, { publishFederation: false })
		// A 已离开，改由新 owner B 充当 merge 权限节点收敛 B、C。
		await converge([NODE_B, NODE_C], NODE_B, groupId)

		for (const node of [NODE_B, NODE_C]) {
			const state = await stateOf(node, groupId)
			assertEquals(state.members[hash.A]?.status, 'left', `${node}: A left`)
			assert(state.roles['post-handoff'], `${node}: B governance worked after handoff`)
		}
	})

	await t.step('step8: 群员退群 + 成员/权限收敛', async () => {
		// C 主动退群：同样 skipCheckpointRebuild 捕获已签名帧后实时推送给仍在群内的 B。
		const leaveC = await M.append.appendEvent(NODE_C, groupId, {
			type: 'member_leave', sender: hash.C, timestamp: Date.now(), content: {},
		}, (await M.localSigner.resolveLocalEventSigner(NODE_C, groupId)).secretKey,
		{ publishFederation: false, skipReleaseQuarantined: true, skipCheckpointRebuild: true })
		await M.remoteIngest.appendValidatedRemoteEvent(NODE_B, groupId, leaveC, { logFailures: false })
		// B 收敛自身分叉（C 已离开，不可再向其灌入事件）。
		await M.lifecycle.convergeDagTipsIfAuthorized(NODE_B, groupId)
		await M.materialize.rebuildAndSaveCheckpoint(NODE_B, groupId)

		// 在仍留存的节点 B 上验证成员收敛：仅 B 活跃，A/C 均已离开。
		const state = await stateOf(NODE_B, groupId)
		const actives = activeMembers(state)
		assertEquals(state.members[hash.C]?.status, 'left', 'B sees C left')
		assert(actives.has(hash.B) && !actives.has(hash.C) && !actives.has(hash.A),
			`B is the only active member (got ${[...actives].length})`)
	})
})

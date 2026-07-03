/**
 * 新版 chat 后端 3 节点真实端到端联邦流程测试（Deno）。
 *
 * 设计：在单进程内用 3 个独立 fount 用户（= 3 个 nodeHash + 3 套独立 DAG 磁盘副本）模拟
 * 节点 A/B/C。事件经各自本地签名后，以「已签名 wire 帧」通过真实联邦入站路径
 * `appendValidatedRemoteEvent` 在节点间传播（等价于 Nostr/Trystero relay 收到帧后的处理），
 * 因此走的是真实的签名校验 / ACL 快照门控 / joinPolicy / 权限矩阵 / reducer 物化管线，
 * 而非纯单进程 mock。
 *
 * 真实 Nostr relay 在离线 CI 下不可用，因此用「直接注入已签名帧」替换 relay 传输介质本身；
 * 帧的产生（本地签名）与帧的消费（联邦入站校验）均为生产代码路径。
 */
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createChatFederationSim } from '../simulation/federation.mjs'

const PRIVATE_CHANNEL = 'secret'

/* global Deno */
Deno.test('chat 3-node E2E', async t => {
	const sim = await createChatFederationSim()
	const {
		modules, groupId, nodeName, federate, gossipAll, converge, joinGroup, postMessage, channelMessage,
		stateOf, activeMembers, adoptSnapshot,
	} = sim
	const NODE_A = nodeName('A')
	const NODE_B = nodeName('B')
	const NODE_C = nodeName('C')
	/** 各节点 member pubKeyHash。
	 * @type {Record<string, string>} */
	const memberPubKeyByNode = {}
	let publicChannelId = ''

	const ownerSigner = await modules.localSigner.getLocalSignerForNewGroup(NODE_A, groupId)
	memberPubKeyByNode.A = ownerSigner.sender

	await t.step('step1: 节点A 建群 (owner=A)', async () => {
		await modules.lifecycle.createGroup(NODE_A, {
			groupId,
			name: 'E2E Group',
			ownerPubKeyHash: memberPubKeyByNode.A,
			secretKey: ownerSigner.secretKey,
			defaultChannelId: 'default',
			enableGroupFederation: false,
		})
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		const state = await stateOf(NODE_A, groupId)
		assertEquals(state.members[memberPubKeyByNode.A]?.status, 'active')
		assert(state.members[memberPubKeyByNode.A]?.roles.includes('founder'), 'owner has founder role')
		publicChannelId = state.groupSettings.defaultChannelId
		assert(!!publicChannelId, 'default channel exists')
	})

	await t.step('step2: 建频道 (公共频道 general + 私密频道 secret)', async () => {
		await modules.channelOps.createChannel(NODE_A, groupId, {
			channelId: 'general', type: 'text', name: 'General', isPrivate: false,
		})
		await modules.channelOps.createChannel(NODE_A, groupId, {
			channelId: PRIVATE_CHANNEL, type: 'text', name: 'Secret', isPrivate: true,
		})
		const state = await stateOf(NODE_A, groupId)
		assert(state.channels.general, 'general channel created')
		assert(state.channels[PRIVATE_CHANNEL]?.isPrivate, 'secret channel is private')
	})

	await t.step('step3: 节点B、C 加入群', async () => {
		// B 加入并同步回 A，A 重建签名 checkpoint（tip 推进到 B_join，保持 DAG 线性）。
		memberPubKeyByNode.B = await joinGroup(NODE_B, NODE_A, groupId, 'invite-e2e')
		await federate(NODE_B, [NODE_A], groupId)
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		// C 从 A 的最新快照（已含 B）加入，C_join 链在 B_join 之后。
		memberPubKeyByNode.C = await joinGroup(NODE_C, NODE_A, groupId, 'invite-e2e')
		await federate(NODE_C, [NODE_A], groupId)
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_A, groupId, { checkpointOwnerSecretKey: ownerSigner.secretKey })
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId, { assertConverged: true })

		for (const node of [NODE_A, NODE_B, NODE_C]) {
			const members = activeMembers(await stateOf(node, groupId))
			assert(members.has(memberPubKeyByNode.A) && members.has(memberPubKeyByNode.B) && members.has(memberPubKeyByNode.C),
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
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_create',
			timestamp: Date.now(),
			content: {
				roleId: 'moderator', name: 'Moderator', color: '#3498db', position: 50,
				permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true, KICK_MEMBERS: true, MANAGE_MESSAGES: true },
				isDefault: false, isHoisted: true,
			},
		}, { publishFederation: false })

		const beforeKick = modules.state.memberChannelPermissions(await stateOf(NODE_A, groupId), memberPubKeyByNode.B, publicChannelId)
		assertEquals(beforeKick[modules.perms.PERMISSIONS.KICK_MEMBERS], false)

		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign',
			timestamp: Date.now(),
			content: { targetMemberKey: memberPubKeyByNode.B, roleId: 'moderator' },
		}, { publishFederation: false })
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId, { assertConverged: true })

		for (const node of [NODE_A, NODE_B, NODE_C]) {
			const perms = modules.state.memberChannelPermissions(await stateOf(node, groupId), memberPubKeyByNode.B, publicChannelId)
			assertEquals(perms[modules.perms.PERMISSIONS.KICK_MEMBERS], true, `${node}: B gained KICK_MEMBERS`)
		}
	})

	await t.step('step5: 多频道发帖并验证联邦同步到 B/C', async () => {
		// B/C 加入后旋转所有频道密钥，使其拿到 K_ch wrap（VIEW_CHANNEL 成员）。
		await modules.schedule.rotateAllChannelKeys(NODE_A, groupId)
		await gossipAll([NODE_A, NODE_B, NODE_C], groupId, { assertConverged: true })

		// 串行发帖 + 实时推送：每条帖即时下发给对端，保持 DAG 线性（避免并发分叉污染后续治理收敛）。
		const m1 = await postMessage(NODE_A, groupId, publicChannelId, 'hello default from A', [NODE_B, NODE_C])
		const m2 = await postMessage(NODE_A, groupId, 'general', 'hello general from A', [NODE_B, NODE_C])
		// B 在公共频道发帖（验证非 owner 节点亦可发帖并反向同步到 A/C）。
		const m3 = await postMessage(NODE_B, groupId, publicChannelId, 'hi default from B', [NODE_A, NODE_C])

		// B/C 收到 A 两条多频道消息且可解密（真正可读）。
		for (const node of [NODE_B, NODE_C]) {
			const r1 = await channelMessage(node, groupId, publicChannelId, m1.id)
			const r2 = await channelMessage(node, groupId, 'general', m2.id)
			assert(r1 && r1.content?.content?.includes('hello default from A'), `${node} reads A's default message`)
			assert(r2 && r2.content?.content?.includes('hello general from A'), `${node} reads A's general message`)
		}
		// A、C 收到 B 的公共频道消息且可解密。
		for (const node of [NODE_A, NODE_C]) {
			const r3 = await channelMessage(node, groupId, publicChannelId, m3.id)
			assert(r3 && r3.content?.content?.includes('hi default from B'), `${node} reads B's message`)
		}
	})

	await t.step('step6: 私密频道细粒度写门控（授权角色+owner 可发，未授权与硬禁言不可发）', async () => {
		// 细粒度权限（分层覆写求值 + ADMIN 旁路）：
		//   私密频道对 @everyone 同时 deny VIEW_CHANNEL + SEND_MESSAGES；对 moderator 角色 allow 二者
		//   （B 在 step4 已获 moderator）。求值优先级：全局基线 < 频道 @everyone 覆写 < 频道角色覆写。
		// 期望：owner A（admin）旁路一切 → 可见可发；B（moderator allow 覆盖 @everyone deny）→ 可见可发；
		//       C（仅 @everyone）→ 不可见不可发。
		const P = modules.perms.PERMISSIONS
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'channel_permissions_update',
			timestamp: Date.now(),
			content: {
				channelId: PRIVATE_CHANNEL,
				roleId: '@everyone',
				allow: {},
				deny: { VIEW_CHANNEL: true, SEND_MESSAGES: true },
			},
		}, { publishFederation: false })
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
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
		const rot = await modules.schedule.appendChannelKeyRotate(NODE_A, groupId, PRIVATE_CHANNEL)
		for (const to of [NODE_B, NODE_C])
			await modules.remoteIngest.appendValidatedRemoteEvent(to, groupId, rot, { logFailures: false })
		await converge([NODE_A, NODE_B, NODE_C], NODE_A, groupId)

		// 权限矩阵：A（admin 旁路）、B（moderator allow 覆盖 @everyone deny）可见可发；C 皆否。
		const aPerms = modules.state.memberChannelPermissions(await stateOf(NODE_A, groupId), memberPubKeyByNode.A, PRIVATE_CHANNEL)
		const bPerms = modules.state.memberChannelPermissions(await stateOf(NODE_B, groupId), memberPubKeyByNode.B, PRIVATE_CHANNEL)
		const cPerms = modules.state.memberChannelPermissions(await stateOf(NODE_C, groupId), memberPubKeyByNode.C, PRIVATE_CHANNEL)
		assertEquals(aPerms[P.VIEW_CHANNEL], true, 'A(owner/admin) can view private channel')
		assertEquals(aPerms[P.SEND_MESSAGES], true, 'A(owner/admin) can send to private channel')
		assertEquals(bPerms[P.VIEW_CHANNEL], true, 'B(moderator allow) can view private channel')
		assertEquals(bPerms[P.SEND_MESSAGES], true, 'B(moderator allow) can send to private channel')
		assertEquals(cPerms[P.VIEW_CHANNEL], false, 'C(@everyone) cannot view private channel')
		assertEquals(cPerms[P.SEND_MESSAGES], false, 'C(@everyone) cannot send to private channel')

		// owner A 发帖：授权读者 A、B 解密成功；未授权 C 收到帧但无 live K_ch → 解密失败。
		const secretA = await postMessage(NODE_A, groupId, PRIVATE_CHANNEL, 'top secret from owner', [NODE_B, NODE_C])
		const aReadA = await channelMessage(NODE_A, groupId, PRIVATE_CHANNEL, secretA.id)
		const bReadA = await channelMessage(NODE_B, groupId, PRIVATE_CHANNEL, secretA.id)
		assert(aReadA?.content?.content?.includes('top secret from owner'), 'A reads own private message')
		assert(bReadA?.content?.content?.includes('top secret from owner'), 'B(authorized role) decrypts private message')
		const cReadA = await channelMessage(NODE_C, groupId, PRIVATE_CHANNEL, secretA.id)
		assert(cReadA, 'C received the private message frame (federated)')
		assertEquals(cReadA?.decryptView?.failed, true, 'C(unauthorized) cannot decrypt private message')

		// 授权非 owner（B）发帖：A 解密成功，C 不可——证明「仅授权角色」可发帖，而非仅 owner。
		const secretB = await postMessage(NODE_B, groupId, PRIVATE_CHANNEL, 'secret reply from moderator', [NODE_A, NODE_C])
		const aReadB = await channelMessage(NODE_A, groupId, PRIVATE_CHANNEL, secretB.id)
		assert(aReadB?.content?.content?.includes('secret reply from moderator'), 'A decrypts B(authorized) private message')
		const cReadB = await channelMessage(NODE_C, groupId, PRIVATE_CHANNEL, secretB.id)
		assertEquals(cReadB?.decryptView?.failed, true, 'C still cannot decrypt B private message')

		// 未授权写门控（DAG authz 层真断）：C 向私密频道发帖被 SEND_MESSAGES 拒绝。
		// federation.mjs 的 postMessage 是联邦辅助函数；真实发帖 API 在 channelMessaging 模块。
		await assertRejects(
			() => modules.channelMessaging.postChannelMessage(NODE_C, groupId, PRIVATE_CHANNEL, { text: 'C must not send' }),
			Error,
		)

		// 不可翻案的硬禁言（user 级 ban）：被 ban 的成员即便持有授予 SEND 的角色、即便频道再 allow，也一律不可发帖。
		// 基于真实 memberChannelPermissions / checkEventPermission 求值（status≠active 先于一切覆写返回全 false）。
		const liveState = await stateOf(NODE_A, groupId)
		assertEquals(
			modules.state.memberChannelPermissions(liveState, memberPubKeyByNode.B, 'general')[P.SEND_MESSAGES], true,
			'B with moderator role can send before mute',
		)
		const mutedState = structuredClone(liveState)
		mutedState.members[memberPubKeyByNode.B].status = 'banned'
		// 即便在 general 上为 moderator 显式 allow SEND，硬禁言仍不可被任何 allow / ADMIN 旁路翻案。
		mutedState.channelPermissions.general = {
			moderator: { allow: { SEND_MESSAGES: true, VIEW_CHANNEL: true }, deny: {} },
		}
		const mutedPerms = modules.state.memberChannelPermissions(mutedState, memberPubKeyByNode.B, 'general')
		assertEquals(mutedPerms[P.SEND_MESSAGES], false, 'hard-muted member cannot send despite SEND-granting role + channel allow')
		assertEquals(mutedPerms[P.VIEW_CHANNEL], false, 'hard-muted member retains no channel permission')
		const mutedAuthz = modules.authorize.checkEventPermission(mutedState, { type: 'message', channelId: 'general' }, memberPubKeyByNode.B)
		assertEquals(mutedAuthz.ok, false, 'DAG authz rejects message from hard-muted member')
	})

	await t.step('step7: 群主退群 + owner 交接', async () => {
		// 交接前先把 B 提升为 founder（具备 MANAGE_ADMINS，方可成为委托 owner）。
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'role_assign',
			timestamp: Date.now(),
			content: { targetMemberKey: memberPubKeyByNode.B, roleId: 'founder' },
		}, { publishFederation: false })
		// owner 设置委托交接给 B。
		await modules.append.appendSignedLocalEvent(NODE_A, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { delegatedOwnerPubKeyHash: memberPubKeyByNode.B },
		}, { publishFederation: false })
		// 把交接相关治理事件传播并收敛（A 仍在群内，由 A 充当 merge 权限节点）。
		await converge([NODE_A, NODE_B, NODE_C], NODE_A, groupId)

		// A 退群（member_leave）。appendEvent 会在 checkpoint 重建时触发 A 本地副本自毁
		// （maybePurgeLocalReplicaIfLeft），故必须 skipCheckpointRebuild 拿到已签名帧后「实时推送」给 B、C，
		// 不能依赖事后扫描 A 的 events.jsonl（彼时可能已被清空）。
		const leaveA = await modules.append.appendEvent(NODE_A, groupId, {
			type: 'member_leave', sender: memberPubKeyByNode.A, timestamp: Date.now(), content: {},
		}, ownerSigner.secretKey, { publishFederation: false, skipReleaseQuarantined: true, skipCheckpointRebuild: true })
		for (const to of [NODE_B, NODE_C])
			await modules.remoteIngest.appendValidatedRemoteEvent(to, groupId, leaveA, { logFailures: false })

		// 交接后 B 应能行使治理权（创建角色），证明治理可用。
		await modules.append.appendSignedLocalEvent(NODE_B, groupId, {
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
			assertEquals(state.members[memberPubKeyByNode.A]?.status, 'left', `${node}: A left`)
			assert(state.roles['post-handoff'], `${node}: B governance worked after handoff`)
		}
	})

	await t.step('step8: 群员退群 + 成员/权限收敛', async () => {
		// C 主动退群：同样 skipCheckpointRebuild 捕获已签名帧后实时推送给仍在群内的 B。
		const leaveC = await modules.append.appendEvent(NODE_C, groupId, {
			type: 'member_leave', sender: memberPubKeyByNode.C, timestamp: Date.now(), content: {},
		}, (await modules.localSigner.resolveLocalEventSigner(NODE_C, groupId)).secretKey,
		{ publishFederation: false, skipReleaseQuarantined: true, skipCheckpointRebuild: true })
		await modules.remoteIngest.appendValidatedRemoteEvent(NODE_B, groupId, leaveC, { logFailures: false })
		// B 收敛自身分叉（C 已离开，不可再向其灌入事件）。
		await modules.lifecycle.convergeDagTipsIfAuthorized(NODE_B, groupId)
		await modules.materialize.rebuildAndSaveCheckpoint(NODE_B, groupId)

		// 在仍留存的节点 B 上验证成员收敛：仅 B 活跃，A/C 均已离开。
		const state = await stateOf(NODE_B, groupId)
		const actives = activeMembers(state)
		assertEquals(state.members[memberPubKeyByNode.C]?.status, 'left', 'B sees C left')
		assert(actives.has(memberPubKeyByNode.B) && !actives.has(memberPubKeyByNode.C) && !actives.has(memberPubKeyByNode.A),
			`B is the only active member (got ${[...actives].length})`)
	})
})

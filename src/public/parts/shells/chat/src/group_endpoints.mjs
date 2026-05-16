import { createHash, randomUUID } from 'node:crypto'

import { calculateMemberPermissions, hasPermission, PERMISSIONS } from '../../../../../scripts/p2p/permissions.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { resolveContentRefsInMessageLines } from './chat/content_ref_resolve.mjs'
import {
	appendEvent as appendDagEvent,
	appendPinEvent,
	appendReactionEvent,
	appendUnpinEvent,
	appendValidatedRemoteEvent,
	computeDagTipIds,
	createGroup as dagCreateGroup,
	deleteChatData,
	getState,
	listUserGroups,
	mergeDagTips,
	syncEvents,
} from './chat/dag.mjs'
import { readJsonl } from './chat/dag_storage.mjs'
import { isPubKeyHashBlocked } from './chat/dm_blocklist.mjs'
import { verifyDmLinkSignature } from './chat/dm_link_verify.mjs'
import { listFederationPeersForGroup, ensureFederationRoom, getFederationConfig, invalidateFederationRoomCache } from './chat/federation.mjs'
import { foldMessageAppendStreamLines } from './chat/fold_channel_message_lines.mjs'
import { messagesPath, eventsPath } from './chat/paths.mjs'
import { loadPeers } from './chat/peers.mjs'
import { loadReputation } from './chat/reputation.mjs'
import { setPowChallenge } from './chat/websocket.mjs'
import { loadChat, modifyTimeLine, triggerCharReply } from './chat.mjs'

/** Ed25519 公钥 32 字节 → 64 位十六进制（小写）。 */
const PUB_KEY_HEX_64 = /^[0-9a-f]{64}$/u

/**
 * @param {string} hex 原始公钥十六进制字符串（可含 `0x` 前缀）
 * @returns {string} 小写、去空白后的十六进制
 */
function normalizeDmPubKeyHex(hex) {
	return String(hex || '').trim().toLowerCase().replace(/^0x/u, '')
}

/**
 * 将两方公钥十六进制按字典序排序后拼接，再取 SHA-256，供 DM 房间标签与 `dmSessionTag`。
 * @param {string} aHex 64 位十六进制公钥之一
 * @param {string} bHex 64 位十六进制公钥之二
 * @returns {{ low: string, high: string, dmSessionTag: string, dmRoomLabelPrefix: string }} 字典序较低/较高键、完整会话标签、SHA-256 十六进制前 16 位作短标签
 */
function computeDmRoomLabelFromPubKeys(aHex, bHex) {
	const a = normalizeDmPubKeyHex(aHex)
	const b = normalizeDmPubKeyHex(bHex)
	if (!PUB_KEY_HEX_64.test(a) || !PUB_KEY_HEX_64.test(b))
		throw new Error('invalid pub key hex for DM label')
	const [low, high] = a < b ? [a, b] : [b, a]
	const dmSessionTag = createHash('sha256').update(`${low}:${high}`, 'utf8').digest('hex')
	return {
		low,
		high,
		dmSessionTag,
		dmRoomLabelPrefix: dmSessionTag.slice(0, 16),
	}
}

/**
 * @param {object} state 物化群状态
 * @returns {string} 治理权限折叠用频道 id
 */
function governanceChannelId(state) {
	const def = state.groupSettings?.defaultChannelId
	if (def && state.channels?.[def]) return def
	const keys = Object.keys(state.channels || {})
	return keys[0] || 'default'
}

/** 仅允许通过 `POST .../groups/:id/events` 本地简体形追加的授权类 DAG 类型。 */
const LOCAL_APPEND_AUTHZ_TYPES = new Set(['peer_invite', 'reputation_slash', 'reputation_reset'])

/**
 * 远程侧已签名的完整 DAG 行（与本地 `{ type, content }` 简体形区分）。
 * @param {unknown} ev 单条事件
 * @returns {boolean} 视为远程签名载荷时为 true
 */
function isFullySignedRemoteDagEvent(ev) {
	if (!ev || typeof ev !== 'object') return false
	if (typeof ev.id !== 'string' || !/^[0-9a-f]{64}$/iu.test(ev.id)) return false
	const sig = typeof ev.signature === 'string' ? ev.signature.trim() : ''
	return /^[0-9a-f]{128}$/iu.test(sig)
}

/**
 * 校验本地追加的授权事件 `content`（在写 DAG 前调用）。
 * @param {string} type 事件类型
 * @param {unknown} content 载荷
 * @param {string} username 当前登录用户（成员键）
 * @param {object} state 物化群状态
 * @returns {void}
 */
function validateLocalAuthzPayload(type, content, username, state) {
	const c = content && typeof content === 'object' ? content : null
	if (!c) throw new Error('content object required')
	if (type === 'reputation_slash' || type === 'reputation_reset') {
		const t = typeof c.targetPubKeyHash === 'string' ? c.targetPubKeyHash.trim() : ''
		if (!t) throw new Error('targetPubKeyHash required')
		const tm = state.members?.[t]
		if (!tm || tm.status !== 'active') throw new Error('target must be active member')
		if (type === 'reputation_slash' && t === username) throw new Error('cannot slash self')
		return
	}
	if (type === 'peer_invite') {
		let from = typeof c.from === 'string' ? c.from.trim() : ''
		const to = (typeof c.to === 'string' ? c.to.trim() : '')
			|| (typeof c.invitee === 'string' ? c.invitee.trim() : '')
		if (!from && typeof c.introducer === 'string') from = c.introducer.trim()
		if (!from) from = username
		if (from !== username) throw new Error('peer_invite introducer must match caller')
		if (!to || to === username) throw new Error('peer_invite requires distinct invitee')
		const fm = state.members?.[from]
		if (!fm || fm.status !== 'active') throw new Error('introducer must be active member')
	}
}

/**
 * 校验一批 `POST .../events` 条目：可混排远程签名事件与本地授权简体形。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {unknown[]} events 事件数组
 * @returns {Promise<void>}
 */
async function validateLocalAuthzBatch(username, groupId, events) {
	const { state } = await getState(username, groupId)
	const member = state.members[username]
	if (!member || member.status !== 'active') throw new Error('Not a member')
	for (const ev of events) {
		if (!ev || typeof ev !== 'object') throw new Error('invalid event entry')
		if (isFullySignedRemoteDagEvent(ev)) continue
		const t = ev.type
		if (!LOCAL_APPEND_AUTHZ_TYPES.has(t))
			throw new Error(`local unsigned append only for: ${[...LOCAL_APPEND_AUTHZ_TYPES].join(', ')} (or pass full signed remote events with id+signature)`)
		validateLocalAuthzPayload(t, ev.content, username, state)
		if (t === 'reputation_reset') {
			const c = ev.content && typeof ev.content === 'object' ? ev.content : {}
			const tgt = typeof c.targetPubKeyHash === 'string' ? c.targetPubKeyHash.trim().toLowerCase() : ''
			if (tgt && isPubKeyHashBlocked(username, tgt))
				throw new Error('reputation_reset ignored for locally blocked target')
			const ch = governanceChannelId(state)
			const perms = calculateMemberPermissions(
				state.members[username],
				state.roles,
				ch,
				state.channelPermissions || {},
			)
			if (!perms[PERMISSIONS.ADMIN] && !perms[PERMISSIONS.MANAGE_ROLES])
				throw new Error('reputation_reset requires ADMIN or MANAGE_ROLES')
		}
	}
}

/**
 * 枚举当前用户在其 shell 数据下已加入的联邦群（有 DAG 且 `member_join` 后为 active）。
 * @param {string} username 登录用户名
 * @returns {Promise<object[]>} 供 `GET .../groups/list` 使用的联邦群摘要行（`listKind: 'p2p'`）
 */
export async function enumerateJoinedFederatedGroups(username) {
	const ids = await listUserGroups(username)
	const rows = []
	for (const groupId of ids) 
		try {
			const { state } = await getState(username, groupId)
			const m = state.members[username]
			if (!m || m.status !== 'active') continue
			let lastActivity = 0
			for (const mb of Object.values(state.members || {})) 
				if (mb?.joinedAt && typeof mb.joinedAt === 'number' && mb.joinedAt > lastActivity)
					lastActivity = mb.joinedAt
			
			const activeMembers = Object.values(state.members || {}).filter(x => x?.status === 'active')
			const name = state.groupMeta?.name || groupId
			const desc = state.groupMeta?.desc || ''
			rows.push({
				listKind: 'p2p',
				groupId,
				name,
				displayTitle: name,
				groupDescription: desc,
				desc,
				avatar: state.groupMeta?.avatar ?? null,
				defaultChannelId: state.groupSettings?.defaultChannelId ?? null,
				memberCount: activeMembers.length,
				channelCount: Object.keys(state.channels || {}).length,
				lastMessageTime: lastActivity || 0,
			})
		}
		catch {
			/* 非 DAG 会话目录等跳过 */
		}
	
	return rows
}

/**
 * 读取某用户某群某频道的消息 JSONL，支持 since/before/limit。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ since?: string, before?: string, limit?: string | number }} q 分页参数
 * @returns {Promise<object[]>} 消息行对象数组
 */
export async function readChannelMessagesForUser(username, groupId, channelId, q) {
	let lines = await readJsonl(messagesPath(username, groupId, channelId))
	if (q.since) {
		const i = lines.findIndex(m => m.eventId === q.since)
		if (i !== -1) lines = lines.slice(i + 1)
	}
	if (q.before) {
		const i = lines.findIndex(m => m.eventId === q.before)
		if (i !== -1) lines = lines.slice(0, i)
	}
	const lim = q.limit != null ? Number(q.limit) : undefined
	if (Number.isFinite(lim) && lim > 0) lines = lines.slice(-lim)
	const { state } = await getState(username, groupId)
	const idle = Number(state.groupSettings?.logicalStreamIdleMs)
	const streamIdleMs = Number.isFinite(idle) && idle > 0 ? idle : undefined
	const folded = foldMessageAppendStreamLines(lines, streamIdleMs)
	return resolveContentRefsInMessageLines(username, folded)
}

/**
 * @param {object} state 物化群状态
 * @param {string} username 成员键
 * @returns {boolean} 是否为活跃成员
 */
function isActiveMember(state, username) {
	return state.members[username]?.status === 'active'
}

/**
 * @param {object} state 物化群状态
 * @param {object} member 成员记录
 * @param {string} permission 权限键
 * @param {string} channelId 频道 ID
 * @returns {boolean} 是否具备权限
 */
function canInChannel(state, member, permission, channelId) {
	return hasPermission(member, permission, state.roles, channelId, state.channelPermissions)
}

/**
 * 注册群相关 HTTP 路由（联邦 DAG 单路径）。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @returns {void}
 */
export function setGroupEndpoints(router) {
	/**
	 * @param {string} method HTTP 方法小写
	 * @param {string} path 路径字面量（含转义冒号）
	 * @param {import('npm:express').RequestHandler} handler 处理函数
	 * @returns {void}
	 */
	const registerRoute = (method, path, handler) => {
		router[method](path, authenticate, handler)
		router[method](new RegExp(`^${path.replaceAll('\\:', ':')}$`), authenticate, handler)
	}

	registerRoute('get', '/api/parts/shells\\:chat/groups/list', async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const rows = await enumerateJoinedFederatedGroups(username).catch(() => [])
			rows.sort(
				(a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0),
			)
			res.status(200).json(rows)
		}
		catch (error) {
			console.error('groups list error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	registerRoute('post', '/api/parts/shells\\:chat/groups/new', async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
			const tpl = typeof body.template === 'string' ? body.template.trim().toLowerCase() : ''
			if (tpl === 'dm') {
				const targetUsername = typeof body.targetUsername === 'string' ? body.targetUsername.trim() : ''
				const myPubKeyHex = typeof body.myPubKeyHex === 'string' ? body.myPubKeyHex : ''
				const peerPubKeyHex = typeof body.peerPubKeyHex === 'string' ? body.peerPubKeyHex : ''

				const hasUser = !!targetUsername
				const hasPeerKey = !!normalizeDmPubKeyHex(peerPubKeyHex)
				const hasMyKey = !!normalizeDmPubKeyHex(myPubKeyHex)
				if (hasUser === hasPeerKey)
					return res.status(400).json({
						success: false,
						error: 'provide exactly one of: targetUsername (string), or myPubKeyHex + peerPubKeyHex (64 hex each)',
					})
				if (hasPeerKey && !hasMyKey)
					return res.status(400).json({ success: false, error: 'myPubKeyHex required when peerPubKeyHex is set' })

				/** @type {Record<string, unknown>} */
				let dmMeta = { dmKind: 'username', dmPeerUsername: targetUsername }
				/** @type {{ dmSessionTag?: string, dmRoomLabelPrefix?: string, dmPubKeyLow?: string, dmPubKeyHigh?: string } | undefined} */
				let keyLabels
				let displayName
				const displayDesc = 'Direct message'

				if (hasPeerKey) {
					const myN = normalizeDmPubKeyHex(myPubKeyHex)
					const peerN = normalizeDmPubKeyHex(peerPubKeyHex)
					if (!PUB_KEY_HEX_64.test(myN) || !PUB_KEY_HEX_64.test(peerN))
						return res.status(400).json({ success: false, error: 'myPubKeyHex and peerPubKeyHex must be 64 hex chars' })
					if (myN === peerN)
						return res.status(400).json({ success: false, error: 'peerPubKeyHex must differ from myPubKeyHex' })
					const dmNonce = typeof body.dmIntroNonce === 'string' ? body.dmIntroNonce.trim() : ''
					const dmSig = typeof body.dmIntroSig === 'string' ? body.dmIntroSig.trim().replace(/^0x/iu, '') : ''
					const hasDmNonce = dmNonce.length > 0
					const hasDmSig = dmSig.length > 0
					if (hasDmNonce !== hasDmSig)
						return res.status(400).json({
							success: false,
							error: 'provide both dmIntroNonce and dmIntroSig for DM link proof or omit both',
						})
					if (hasDmNonce && !await verifyDmLinkSignature(peerN, dmNonce, dmSig))
						return res.status(400).json({ success: false, error: 'invalid dm intro link signature' })
					const { low, high, dmSessionTag, dmRoomLabelPrefix } = computeDmRoomLabelFromPubKeys(myN, peerN)
					dmMeta = {
						dmKind: 'ecdh',
						dmSessionTag,
						dmRoomLabelPrefix,
						dmPubKeyLow: low,
						dmPubKeyHigh: high,
					}
					keyLabels = { dmSessionTag, dmRoomLabelPrefix, dmPubKeyLow: low, dmPubKeyHigh: high }
					displayName = `DM · ${dmRoomLabelPrefix}`
				}
				else 
					displayName = `DM: ${username} & ${targetUsername}`
				

				const result = await dagCreateGroup(username, {
					name: displayName,
					desc: displayDesc,
					ownerPubKeyHash: username,
				})
				const gid = result.groupId
				await appendDagEvent(username, gid, {
					type: 'group_meta_update',
					sender: username,
					timestamp: Date.now(),
					content: dmMeta,
				})
				invalidateFederationRoomCache(username, gid)
				if (getFederationConfig(username).enabled)
					void ensureFederationRoom(username, gid).catch(e => console.error('Federation rebind after DM:', e))

				return res.status(201).json({
					success: true,
					groupId: gid,
					defaultChannelId: result.defaultChannelId,
					...keyLabels,
				})
			}

			const result = await dagCreateGroup(username, {
				name: body.name || 'New Group',
				desc: body.description || body.desc || '',
				ownerPubKeyHash: username,
				defaultChannelName: body.defaultChannelName,
				defaultChannelId: body.defaultChannelId,
			})
			res.status(201).json({
				success: true,
				groupId: result.groupId,
				defaultChannelId: result.defaultChannelId,
				channelId: result.defaultChannelId,
			})
		}
		catch (error) {
			console.error('groups new error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/reputation$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const reputation = await loadReputation(username, groupId)
			res.status(200).json({ success: true, reputation })
		}
		catch (error) {
			console.error('Get reputation error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	/** 联邦对等端 + 本地 `peers.json` 稀疏池线索（§7.2、§19）。 */
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/peers$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const roster = await listFederationPeersForGroup(username, groupId)
			const stored = await loadPeers(username, groupId)
			res.status(200).json({
				success: true,
				selfNodeId: roster.selfNodeId,
				federationEnabled: roster.federationEnabled,
				peers: roster.peers,
				trustedPeers: stored.trustedPeers,
				explorePeers: stored.explorePeers,
				blockedPeers: stored.blockedPeers,
			})
		}
		catch (error) {
			console.error('Get peers error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	/** 当前 DAG 叶 id（多父分叉检测；§0）。 */
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/dag\/tips$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const events = await readJsonl(eventsPath(username, groupId))
			res.status(200).json({ success: true, tips: computeDagTipIds(events) })
		}
		catch (error) {
			console.error('Get dag tips error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	/** 将当前所有 DAG 叶合并为一条多父 `dag_tip_merge` 事件（需 `MANAGE_CHANNELS`）。 */
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/dag\/merge-tips$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const event = await mergeDagTips(username, groupId, username)
			res.status(200).json({ success: true, event })
		}
		catch (error) {
			console.error('Merge dag tips error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	const MEMBERS_PAGE_SIZE = 50

	/** 成员分页（与 `members_root` 草案对齐的本地物化分页）。 */
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/members\/page\/(\d+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const pageIdx = Math.max(0, Number(req.params[1]) || 0)
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const actives = Object.entries(state.members || {}).filter(([, m]) => m?.status === 'active')
			const pages = Math.max(1, Math.ceil(actives.length / MEMBERS_PAGE_SIZE))
			const slice = actives.slice(pageIdx * MEMBERS_PAGE_SIZE, (pageIdx + 1) * MEMBERS_PAGE_SIZE)
			const members = slice.map(([key, m]) => ({
				pubKeyHash: m.pubKeyHash || key,
				memberId: m.pubKeyHash || key,
				roles: m.roles || [],
				joinedAt: m.joinedAt,
				profile: { name: m.displayName || key },
			}))
			res.status(200).json({ members, members_pages_count: pages })
		}
		catch (error) {
			console.error('Get members page error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/pow-challenge$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const difficulty = state.groupSettings?.powDifficulty || 4
			const challenge = randomUUID()
			setPowChallenge(username, groupId, challenge)
			res.status(200).json({ success: true, challenge: { challenge, difficulty } })
		}
		catch (error) {
			console.error('PoW challenge error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/join$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { inviteCode, pow, introducerPubKeyHash, rep_edge } = req.body
			const content = { inviteCode, powSolution: pow }
			if (typeof introducerPubKeyHash === 'string' && introducerPubKeyHash.trim()) {
				const n = normalizeDmPubKeyHex(introducerPubKeyHash)
				if (PUB_KEY_HEX_64.test(n)) content.introducerPubKeyHash = n
			}
			if (typeof rep_edge === 'number' && Number.isFinite(rep_edge))
				content.rep_edge = Math.max(-1, Math.min(1, rep_edge))

			await appendDagEvent(username, groupId, {
				type: 'member_join',
				sender: username,
				timestamp: Date.now(),
				content,
			})
			const { state } = await getState(username, groupId)
			res.status(200).json({
				success: true,
				groupId,
				defaultChannelId: state.groupSettings.defaultChannelId,
			})
		}
		catch (error) {
			console.error('Join group error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/state$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state, checkpoint } = await getState(username, groupId)
			const member = state.members[username]
			const active = isActiveMember(state, username)

			let channels = state.channels
			let channelPermissions = state.channelPermissions || {}
			const groupSettings = { ...state.groupSettings }

			if (active) {
				channels = {}
				for (const [channelId, channel] of Object.entries(state.channels || {})) {
					const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
					const canManage = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
					if (canView || canManage)
						channels[channelId] = channel
				}

				channelPermissions = Object.fromEntries(
					Object.entries(state.channelPermissions || {}).filter(([channelId]) => channelId in channels),
				)

				if (groupSettings.defaultChannelId && !(groupSettings.defaultChannelId in channels))
					groupSettings.defaultChannelId = Object.keys(channels)[0] || null
			}

			const activeMembers = Object.entries(state.members)
				.filter(([, m]) => m.status === 'active')
				.map(([key, m]) => ({
					username: m.pubKeyHash || key,
					pubKeyHash: m.pubKeyHash || key,
					roles: m.roles || ['@everyone'],
					joinedAt: m.joinedAt,
				}))

			let pinsByChannel = {}
			const rawPins = checkpoint?.overlay?.pins
				?? checkpoint?.members_record?.messageOverlay?.pins
			if (rawPins && typeof rawPins === 'object' && !Array.isArray(rawPins))
				pinsByChannel = /** @type {Record<string, string[]>} */ rawPins

			const serializableState = {
				groupId: state.groupId,
				groupMeta: state.groupMeta,
				groupSettings,
				channels,
				roles: state.roles,
				channelPermissions,
				members: activeMembers,
				memberCount: activeMembers.length,
				isMember: active,
				myRoles: member?.roles || [],
				viewerMemberPubKeyHash: active ? member?.pubKeyHash || username : null,
				pinsByChannel,
			}
			res.status(200).json({ success: true, state: serializableState })
		}
		catch (error) {
			console.error('Get group state error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/snapshot$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { checkpoint } = await getState(username, req.params[0])
			res.status(200).json({ success: true, snapshot: checkpoint })
		}
		catch (error) {
			console.error('Get snapshot error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/events$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = typeof req.query.channelId === 'string' && req.query.channelId.trim()
				? req.query.channelId.trim()
				: undefined
			const { events, truncated } = await syncEvents(username, groupId, {
				since: typeof req.query.since === 'string' ? req.query.since : undefined,
				limit: req.query.limit,
				channelId,
			})
			res.status(200).json({ success: true, events, truncated })
		}
		catch (error) {
			console.error('Sync events error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/events$/, authenticate, async (req, res) => {
		/*
		 * 推送 DAG 事件：
		 * - 远程：每条为完整签名对象（`id` 64 hex + `signature` 128 hex），经 `appendValidatedRemoteEvent`；
		 * - 本地：无签名简体形，仅允许 `peer_invite` / `reputation_slash` / `reputation_reset`，服务端以会话用户为 `sender` 写 DAG。
		 * DevTools 示例（密钥 DM 邀请对端用户名后由其带码加入）：
		 *   fetch('/api/parts/shells:chat/groups/'+groupId+'/events',{method:'POST',credentials:'include',
		 *     headers:{'Content-Type':'application/json'},
		 *     body:JSON.stringify({events:[{type:'peer_invite',content:{to:'otherUser',rep_edge:0.5}}]})})
		 */
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const events = Array.isArray(req.body) ? req.body : req.body?.events
			if (!Array.isArray(events))
				return res.status(400).json({ success: false, error: 'events array required' })

			try {
				await validateLocalAuthzBatch(username, groupId, events)
			}
			catch (err) {
				return res.status(400).json({ success: false, error: err.message })
			}

			let applied = 0
			for (const event of events) {
				if (event?.groupId && event.groupId !== groupId)
					continue
				if (isFullySignedRemoteDagEvent(event)) {
					const r = await appendValidatedRemoteEvent(username, groupId, event, { logFailures: false })
					if (r === 'ok')
						applied++
				}
				else {
					await appendDagEvent(username, groupId, {
						type: event.type,
						sender: username,
						timestamp: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
							? event.timestamp
							: Date.now(),
						content: event.content && typeof event.content === 'object' ? event.content : {},
					})
					applied++
				}
			}
			res.status(200).json({ success: true, applied })
		}
		catch (error) {
			console.error('Push events error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const isAdmin = (member.roles || []).includes('admin')
			if (!isAdmin)
				return res.status(403).json({ success: false, error: 'Only admins can delete the group' })

			await deleteChatData(username, groupId)
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Delete group error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/timeline$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const meta = await loadChat(groupId)
			if (!meta?.timeLines?.length)
				return res.status(200).json({ current: 0, total: 1 })

			const total = meta.timeLines.length
			const current = Math.min(Math.max(0, Number(meta.timeLineIndex) || 0), total - 1)
			res.status(200).json({ current, total })
		}
		catch (error) {
			console.error('Get channel timeline error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/timeline$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const { delta } = req.body || {}
			if (typeof delta !== 'number' || !Number.isFinite(delta))
				return res.status(400).json({ success: false, error: 'delta required' })

			const entry = await modifyTimeLine(groupId, delta)
			res.status(200).json({ success: true, entry: await entry.toData(username) })
		}
		catch (error) {
			console.error('Put channel timeline error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/trigger-reply$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const { charname } = req.body || {}
			if (!charname || typeof charname !== 'string')
				return res.status(400).json({ success: false, error: 'charname required' })

			await triggerCharReply(groupId, charname)
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Channel trigger-reply error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/reactions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { targetEventId, emoji, remove, targetPubKeyHash } = req.body || {}
			if (!targetEventId || !emoji)
				return res.status(400).json({ success: false, error: 'targetEventId and emoji required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const type = remove ? 'reaction_remove' : 'reaction_add'
			await appendReactionEvent(username, groupId, {
				type,
				channelId,
				targetEventId,
				emoji,
				sender: username,
				targetPubKeyHash,
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Channel reactions error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/pin$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { targetEventId, unpin } = req.body || {}
			if (!targetEventId)
				return res.status(400).json({ success: false, error: 'targetEventId required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			if (unpin)
				await appendUnpinEvent(username, groupId, channelId, targetEventId, username)
			else
				await appendPinEvent(username, groupId, channelId, targetEventId, username)

			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Channel pin error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/threads$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const parentChannelId = req.params[1]
			const { parentEventId } = req.body || {}
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[parentChannelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canThreads = canInChannel(state, member, PERMISSIONS.CREATE_THREADS, parentChannelId)
				|| canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, parentChannelId)
			if (!canThreads)
				return res.status(403).json({ success: false, error: 'No permission to create threads' })

			const newChannelId = `thread_${Date.now()}_${randomUUID().slice(0, 8)}`
			await appendDagEvent(username, groupId, {
				type: 'channel_create',
				sender: username,
				timestamp: Date.now(),
				content: {
					channelId: newChannelId,
					type: 'text',
					name: parentEventId ? `thread:${String(parentEventId).slice(0, 12)}` : 'Thread',
					desc: '',
					parentChannelId,
					syncScope: 'channel',
					encryptionScheme: state.channels[parentChannelId]?.encryptionScheme || 'mailbox-ecdh',
				},
			})
			res.status(201).json({ success: true, channelId: newChannelId })
		}
		catch (error) {
			console.error('Create thread channel error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	/** 与经典 `/groups/:id/message` 对齐的频道级入口（AI 自动触发、空触发等）。 */
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/message$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { reply, content: rawContent } = req.body || {}
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			let content = rawContent
			if (reply && typeof reply === 'object') {
				const c = reply.content
				content = typeof c === 'string' ? { text: c } : c && typeof c === 'object' ? c : { text: '' }
				if (reply.isAutoTrigger) content = { ...content, isAutoTrigger: true }
			}
			if (content == null) content = { text: '' }

			const event = await appendDagEvent(username, groupId, {
				type: 'message',
				channelId,
				sender: username,
				timestamp: Date.now(),
				content: typeof content === 'string' ? { text: content } : content,
			})
			res.status(200).json({ success: true, event })
		}
		catch (error) {
			console.error('Channel message (singular) error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/message-append$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const body = req.body && typeof req.body === 'object' ? req.body : {}
			const logical_stream_id = typeof body.logical_stream_id === 'string' ? body.logical_stream_id.trim() : ''
			const text = typeof body.text === 'string' ? body.text : ''
			const chunk_index = body.chunk_index != null ? Number(body.chunk_index) : undefined

			if (!logical_stream_id)
				return res.status(400).json({ success: false, error: 'logical_stream_id required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })
			const canSend = canInChannel(state, member, PERMISSIONS.SEND_MESSAGES, channelId)
			if (!canSend)
				return res.status(403).json({ success: false, error: 'SEND_MESSAGES denied' })

			const content = { logical_stream_id, text }
			if (Number.isFinite(chunk_index)) content.chunk_index = chunk_index
			if (body.content_ref && typeof body.content_ref === 'object')
				content.content_ref = body.content_ref

			const event = await appendDagEvent(username, groupId, {
				type: 'message_append',
				channelId,
				sender: username,
				timestamp: Date.now(),
				content,
			})
			res.status(200).json({ success: true, event })
		}
		catch (error) {
			console.error('message_append error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { since, before, limit } = req.query

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			if (!canView)
				return res.status(403).json({ success: false, error: 'No permission to view channel' })

			const messages = await readChannelMessagesForUser(username, groupId, channelId, {
				since: since || undefined,
				before: before || undefined,
				limit,
			})
			res.status(200).json({ success: true, messages })
		}
		catch (error) {
			console.error('Get channel messages error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/default-channel$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.body?.channelId
			if (!channelId || typeof channelId !== 'string')
				return res.status(400).json({ success: false, error: 'channelId required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canManage = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManage)
				return res.status(403).json({ success: false, error: 'No permission to set default channel' })

			await appendDagEvent(username, groupId, {
				type: 'group_settings_update',
				sender: username,
				timestamp: Date.now(),
				content: { defaultChannelId: channelId },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Set default channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/meta$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { name, desc } = req.body
			await appendDagEvent(username, groupId, {
				type: 'group_meta_update',
				sender: username,
				timestamp: Date.now(),
				content: { name, desc },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Update group meta error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/settings$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			await appendDagEvent(username, groupId, {
				type: 'group_settings_update',
				sender: username,
				timestamp: Date.now(),
				content: req.body,
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Update group settings error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { type, name, desc, isPrivate } = req.body
			const channelName = String(name || '').trim()
			if (!channelName)
				return res.status(400).json({ success: false, error: 'Channel name is required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, state.groupSettings.defaultChannelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			const channelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
			await appendDagEvent(username, groupId, {
				type: 'channel_create',
				sender: username,
				timestamp: Date.now(),
				content: { channelId, type: type || 'text', name: channelName, desc: desc || '', isPrivate: isPrivate || false },
			})
			res.status(201).json({ success: true, channelId })
		}
		catch (error) {
			console.error('Create channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { name, desc, type, isPrivate, parentChannelId, encryptionScheme, encryptionVersion } = req.body

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			const updates = {}
			if (name !== undefined) {
				const trimmed = String(name).trim()
				if (!trimmed)
					return res.status(400).json({ success: false, error: 'Channel name cannot be empty' })
				updates.name = trimmed
			}
			if (desc !== undefined)
				updates.desc = String(desc)
			if (type !== undefined)
				updates.type = type
			if (isPrivate !== undefined)
				updates.isPrivate = Boolean(isPrivate)
			if (parentChannelId !== undefined)
				updates.parentChannelId = parentChannelId || null
			if (encryptionScheme !== undefined)
				updates.encryptionScheme = encryptionScheme === 'none' ? null : String(encryptionScheme)
			if (encryptionVersion !== undefined) {
				const v = Number(encryptionVersion)
				if (Number.isFinite(v)) updates.encryptionVersion = Math.floor(v)
			}

			if (Object.keys(updates).length === 0)
				return res.status(400).json({ success: false, error: 'No channel updates provided' })

			await appendDagEvent(username, groupId, {
				type: 'channel_update',
				sender: username,
				timestamp: Date.now(),
				content: { channelId, updates },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Update channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })
			if (state.groupSettings.defaultChannelId === channelId)
				return res.status(400).json({ success: false, error: 'Cannot delete default channel' })

			await appendDagEvent(username, groupId, {
				type: 'channel_delete',
				sender: username,
				timestamp: Date.now(),
				content: { channelId },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Delete channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const pubKeyHash = typeof req.query.pubKeyHash === 'string' && req.query.pubKeyHash.trim()
				? req.query.pubKeyHash.trim()
				: username
			const channelId = typeof req.query.channelId === 'string' && req.query.channelId.trim()
				? req.query.channelId.trim()
				: 'default'

			const { state } = await getState(username, groupId)
			const member = state.members[pubKeyHash]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const flat = calculateMemberPermissions(
				member,
				state.roles || {},
				channelId,
				state.channelPermissions || {},
			)
			res.status(200).json(flat)
		}
		catch (error) {
			console.error('Get effective permissions error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canView && !canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to view channel permissions' })

			const permissions = state.channelPermissions?.[channelId] || {}
			res.status(200).json({ success: true, permissions })
		}
		catch (error) {
			console.error('Get channel permissions error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { roleId, allow, deny } = req.body
			if (!roleId)
				return res.status(400).json({ success: false, error: 'roleId is required' })

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })
			if (!state.roles[roleId])
				return res.status(404).json({ success: false, error: 'Role not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			await appendDagEvent(username, groupId, {
				type: 'channel_permissions_update',
				sender: username,
				timestamp: Date.now(),
				content: { channelId, roleId, allow: allow || {}, deny: deny || {} },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Update channel permissions error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { name, color } = req.body

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canManageRoles)
				return res.status(403).json({ success: false, error: 'No permission to manage roles' })

			const roleId = (name || 'role').trim().toLowerCase().replaceAll(/\s+/g, '_') + '_' + Date.now()
			const roleName = (name || '').trim()
			if (!roleName)
				return res.status(400).json({ success: false, error: 'Role name is required' })

			await appendDagEvent(username, groupId, {
				type: 'role_create',
				sender: username,
				timestamp: Date.now(),
				content: {
					roleId,
					name: roleName,
					color: color || '#99AAB5',
					position: 10,
					permissions: { VIEW_CHANNEL: true },
					isDefault: false,
					isHoisted: false,
				},
			})
			res.status(201).json({ success: true, roleId })
		}
		catch (error) {
			console.error('Create role error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const roleId = decodeURIComponent(req.params[1])

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canManageRoles)
				return res.status(403).json({ success: false, error: 'No permission to manage roles' })

			const role = state.roles[roleId]
			if (!role)
				return res.status(404).json({ success: false, error: 'Role not found' })
			if (role.isDefault)
				return res.status(400).json({ success: false, error: 'Default role cannot be deleted' })

			await appendDagEvent(username, groupId, {
				type: 'role_delete',
				sender: username,
				timestamp: Date.now(),
				content: { roleId },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Delete role error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/members\/([^/]+)\/(kick|ban)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const targetUsername = decodeURIComponent(req.params[1])
			const action = req.params[2]

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const requiredPermission = action === 'ban' ? PERMISSIONS.BAN_MEMBERS : PERMISSIONS.KICK_MEMBERS
			const canModerate = hasPermission(member, requiredPermission, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canModerate)
				return res.status(403).json({ success: false, error: 'No permission to moderate members' })

			if (!state.members[targetUsername])
				return res.status(404).json({ success: false, error: 'Member not found' })
			if (targetUsername === username)
				return res.status(400).json({ success: false, error: 'Cannot moderate yourself' })

			await appendDagEvent(username, groupId, {
				type: action === 'ban' ? 'member_ban' : 'member_kick',
				sender: username,
				timestamp: Date.now(),
				content: { targetPubKeyHash: targetUsername },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Moderate member error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const roleId = decodeURIComponent(req.params[1])
			const { permission, enabled, permissions: bulkPermissions } = req.body

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canManageRoles)
				return res.status(403).json({ success: false, error: 'No permission to manage roles' })

			const role = state.roles[roleId]
			if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

			let updatedPermissions
			if (permission === '__bulk__' && bulkPermissions)
				updatedPermissions = bulkPermissions
			else {
				updatedPermissions = { ...role.permissions }
				if (enabled) updatedPermissions[permission] = true
				else delete updatedPermissions[permission]
			}

			await appendDagEvent(username, groupId, {
				type: 'role_update',
				sender: username,
				timestamp: Date.now(),
				content: { roleId, updates: { permissions: updatedPermissions } },
			})
			res.status(200).json({ success: true })
		}
		catch (error) {
			console.error('Update role permission error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { content } = req.body

			const { state } = await getState(username, groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			if (!canView)
				return res.status(403).json({ success: false, error: 'No permission to view channel' })

			const event = await appendDagEvent(username, groupId, {
				type: 'message',
				channelId,
				sender: username,
				timestamp: Date.now(),
				content: typeof content === 'string' ? { text: content } : content,
			})
			res.status(201).json({ success: true, event })
		}
		catch (error) {
			console.error('Send channel message error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})
}

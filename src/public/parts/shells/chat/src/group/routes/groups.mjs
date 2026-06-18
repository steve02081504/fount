/**
 * 【文件】group/routes/groups.mjs
 * 【职责】群生命周期 HTTP：列表、创建（含 DM 模板）、时间线切换与管理员删除本地 replica。
 * 【原理】GET 列表经 enumerateJoinedFederatedGroups；POST 普通群走 createGroup+initGroupFileMasterKey，DM 走 createEcdhDmGroup；timeline 委托 session/generation；DELETE 需 ADMIN/MANAGE_ADMINS。
 * 【数据结构】群列表行、201 响应（groupId/defaultChannelId）、timeline {current,total}、DM intro 证明字段。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/dag/lifecycle、chat/dm、queries.mjs、access.mjs。
 */
import { randomUUID } from 'node:crypto'

import { HEX_ID_64 as PUB_KEY_HEX_64, normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { calculateMemberPermissions, PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { createGroup, removeLocalGroupReplica } from '../../chat/dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../../chat/dag/localSigner.mjs'
import { createEcdhDmGroup } from '../../chat/dm/index.mjs'
import { validateDmIntroLinkProof } from '../../chat/dm/linkValidate.mjs'
import { newMetadata } from '../../chat/session/crud.mjs'
import { modifyTimeLine } from '../../chat/session/generation.mjs'
import { getActiveGroupRuntime } from '../../chat/session/persistence.mjs'
import { registerGroupRuntime } from '../../chat/session/runtime.mjs'
import { governanceChannelId } from '../access.mjs'
import { enumerateJoinedFederatedGroups } from '../queries.mjs'
import { buildGroupPreview } from '../groupPreview.mjs'

import { requireGroupMember } from './middleware.mjs'

/**
 * 注册群列表、创建与删除路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGroupLifecycleRoutes(router, authenticate) {
	router.get(/^\/api\/parts\/shells:chat\/groups\/?$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const rows = await enumerateJoinedFederatedGroups(username)
		rows.sort((left, right) => new Date(right.lastMessageTime || 0) - new Date(left.lastMessageTime || 0))
		res.status(200).json(rows)
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/?$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body || {}
		const template = String(body.template || '').trim().toLowerCase()
		if (template === 'dm') {
			const myPubKeyHex = normalizePubKeyHex(body.myPubKeyHex || '')
			const peerPubKeyHex = normalizePubKeyHex(body.peerPubKeyHex || '')
			if (!PUB_KEY_HEX_64.test(myPubKeyHex) || !PUB_KEY_HEX_64.test(peerPubKeyHex))
				return res.status(400).json({ error: 'myPubKeyHex and peerPubKeyHex must be 64 hex chars' })
			if (myPubKeyHex === peerPubKeyHex)
				return res.status(400).json({ error: 'peerPubKeyHex must differ from myPubKeyHex' })
			const dmNonce = String(body.dmIntroNonce || '').trim()
			const dmIntroSignatureHex = String(body.dmIntroSignatureHex || '').trim().replace(/^0x/iu, '')
			const hasDmNonce = dmNonce.length > 0
			const hasDmSignature = dmIntroSignatureHex.length > 0
			if (hasDmNonce !== hasDmSignature)
				return res.status(400).json({
					error: 'provide both dmIntroNonce and dmIntroSignatureHex for DM link proof or omit both',
				})
			if (hasDmNonce) {
				const dmCheck = await validateDmIntroLinkProof(username, { members: {} }, peerPubKeyHex, dmNonce, dmIntroSignatureHex)
				if (!dmCheck.ok)
					return res.status(400).json({ error: dmCheck.error })
			}

			const directMessage = await createEcdhDmGroup(username, myPubKeyHex, peerPubKeyHex)
			return res.status(201).json({
				groupId: directMessage.groupId,
				defaultChannelId: directMessage.defaultChannelId,
				dmSessionTag: directMessage.dmSessionTag,
				dmRoomLabelPrefix: directMessage.dmSessionTag.slice(0, 16),
			})
		}

		const { normalizeFriendBinding } = await import('../../chat/lib/friendBinding.mjs')
		const friendBinding = normalizeFriendBinding(body.friendBinding)
		if (friendBinding && !body.forceNew) {
			const rows = await enumerateJoinedFederatedGroups(username)
			const existing = rows.find(row =>
				row.friendBinding?.entityHash?.toLowerCase() === friendBinding.entityHash.toLowerCase(),
			)
			if (existing) {
				registerGroupRuntime(existing.groupId, username)
				return res.status(200).json({
					groupId: existing.groupId,
					defaultChannelId: 'default',
					reused: true,
				})
			}
		}

		const groupId = body.groupId || randomUUID()
		const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, groupId)
		const result = await createGroup(username, {
			groupId,
			name: body.name || 'New Group',
			description: body.description ?? '',
			ownerPubKeyHash,
			secretKey,
			defaultChannelName: body.defaultChannelName,
			defaultChannelId: body.defaultChannelId,
			...friendBinding ? { friendBinding } : {},
		})
		registerGroupRuntime(result.groupId, username)
		await newMetadata(result.groupId, username)
		res.status(201).json({
			groupId: result.groupId,
			defaultChannelId: result.defaultChannelId,
		})
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/preview$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		res.status(200).json(await buildGroupPreview(username, groupId))
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/timeline$/, authenticate, requireGroupMember(), async (req, res) => {
		const { groupId } = req.groupContext
		const meta = await getActiveGroupRuntime(groupId)
		if (!meta?.timeLines?.length)
			return res.status(200).json({ current: 0, total: 1 })

		const total = meta.timeLines.length
		const current = Math.min(Math.max(0, Number(meta.timeLineIndex) || 0), total - 1)
		res.status(200).json({ current, total })
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/timeline$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId } = req.groupContext
		let { delta } = req.body || {}
		if (delta === null) delta = Number.POSITIVE_INFINITY
		if (typeof delta !== 'number' || !Number.isFinite(delta))
			return res.status(400).json({ error: 'delta required' })

		const channelId = String(req.body?.channelId || 'default').trim() || 'default'
		const entry = await modifyTimeLine(groupId, channelId, delta)
		res.status(200).json({ entry: await entry.toData(username) })
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, groupId, state, member } = req.groupContext
		const permissionsChannelId = governanceChannelId(state)
		const perms = calculateMemberPermissions(member, state.roles, permissionsChannelId, state.channelPermissions)
		if (!perms[PERMISSIONS.ADMIN] && !perms[PERMISSIONS.MANAGE_ADMINS])
			return res.status(403).json({ error: 'Only admins can delete the group' })

		await removeLocalGroupReplica(username, groupId)
		res.status(200).json({})
	})
}

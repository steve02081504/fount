/**
 * 【文件】group/routes/governance.mjs
 * 【职责】群治理 HTTP：角色/频道权限、踢禁、密钥轮换、群主接替及群文件路由挂载。
 * 【原理】读权限用 calculateMemberPermissions；写操作 appendSignedLocalEvent；ban 联动 blocklist/peers；owner-succession 校验管理员联署阈值后 role_assign/revoke。
 * 【数据结构】扁平 permissions map、roleId/channelId、banScope、owner succession ballot/adminSignatures。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/governance/*、chat/files/groupFiles、access.mjs。
 */
import { Buffer } from 'node:buffer'

import { addDenylistFromBanContent, addGroupBlockedPeers, removeGroupBlockedPeer } from '../../../../../../../scripts/p2p/denylist.mjs'
import { pubKeyHash } from '../../../../../../../scripts/p2p/crypto.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { generateKeyRotationNonce, deriveNextFileMasterKey } from '../../../../../../../scripts/p2p/key_crypto.mjs'
import { verifyOwnerSuccessionThreshold } from '../../../../../../../scripts/p2p/owner_succession_ballot.mjs'
import { calculateMemberPermissions, hasPermission, PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { getUserByReq } from '../../../../../../../server/auth.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { appendKeyRotateEvent } from '../../chat/dag/channelOps.mjs'
import { adminPubKeyHashes } from '../../chat/dag/groupMaterializedState.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { getCurrentFileMasterKey, appendFileMasterKey } from '../../chat/file_keys/store.mjs'
import { registerGroupFileRoutes } from '../../chat/files/groupFiles.mjs'
import {
	blockEntriesFromBanContent,
	buildMemberBanContent,
	isBanScope,
	unbanTargetsFromMember,
} from '../../chat/governance/banRules.mjs'
import { signOwnerSuccessionAsLocalAdmin } from '../../chat/governance/ownerSuccessionSign.mjs'
import {
	canInChannel,
	governanceChannelId,
	resolveActiveMemberKey,
	resolveActiveMemberKeyForLocalUser,
	resolveMemberKey,
} from '../access.mjs'

import { requireGroupMember, resolveGroupMember } from './middleware.mjs'

/**
 * 注册权限/治理/成员管理相关 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGovernanceRoutes(router, authenticate) {
	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = req.params[0]
		const subject = (req.query.pubKeyHash || '').trim()
		const channelId = (req.query.channelId || '').trim() || 'default'

		const { state } = await getState(username, groupId)
		let resolvedKey = subject ? resolveActiveMemberKey(state, subject) : null
		if (!resolvedKey)
			resolvedKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!resolvedKey)
			return res.status(403).json({ error: 'Not a member' })
		const member = state.members[resolvedKey]
		if (!state.channels[channelId])
			return res.status(404).json({ error: 'Channel not found' })

		const flat = calculateMemberPermissions(member, state.roles, channelId, state.channelPermissions)
		res.status(200).json(flat)
	})

	router.get(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, requireGroupMember(), async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { state, member } = req.groupContext
		if (!state.channels[channelId])
			return res.status(404).json({ error: 'Channel not found' })

		const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
		const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
		if (!canView && !canManageChannels)
			return res.status(403).json({ error: 'No permission to view channel permissions' })

		const permissions = state.channelPermissions?.[channelId] || {}
		res.status(200).json({ permissions })
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, requireGroupMember(), async (req, res) => {
		const groupId = req.params[0]
		const channelId = req.params[1]
		const { roleId, allow, deny } = req.body
		if (!roleId)
			return res.status(400).json({ error: 'roleId is required' })

		const { username, state, member } = req.groupContext
		if (!state.channels[channelId])
			return res.status(404).json({ error: 'Channel not found' })
		if (!state.roles[roleId])
			return res.status(404).json({ error: 'Role not found' })

		const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
		if (!canManageChannels)
			return res.status(403).json({ error: 'No permission to manage channels' })

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_permissions_update',
			timestamp: Date.now(),
			content: { channelId, roleId, allow: allow || {}, deny: deny || {} },
		})
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles$/, authenticate, requireGroupMember(), async (req, res) => {
		const groupId = req.params[0]
		const {
			body: { name, color },
			groupContext: { username, state, member }
		} = req

		const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, governanceChannelId(state), state.channelPermissions)
		if (!canManageRoles)
			return res.status(403).json({ error: 'No permission to manage roles' })

		const roleName = name?.trim()
		if (!roleName)
			return res.status(400).json({ error: 'Role name is required' })
		const roleId = roleName.toLowerCase().replaceAll(/\s+/g, '_') + '_' + Date.now()

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_create',
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
		res.status(201).json({ roleId })
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles\/([^/]+)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const roleId = decodeURIComponent(req.params[1])
		const { name, color, position, isHoisted } = req.body || {}

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership

		const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, governanceChannelId(state), state.channelPermissions)
		if (!canManageRoles)
			return res.status(403).json({ error: 'No permission to manage roles' })

		const role = state.roles[roleId]
		if (!role) return res.status(404).json({ error: 'Role not found' })

		const updates = {}
		const roleName = name?.trim()
		if (roleName) updates.name = roleName
		const roleColor = color?.trim()
		if (roleColor) updates.color = roleColor
		if (Number.isFinite(position)) updates.position = position
		if (isHoisted != null) updates.isHoisted = !!isHoisted
		if (!Object.keys(updates).length)
			return res.status(400).json({ error: 'No updatable fields provided' })

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_update',
			timestamp: Date.now(),
			content: { roleId, updates },
		})
		res.status(200).json({})
	})

	router.delete(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles\/([^/]+)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const roleId = decodeURIComponent(req.params[1])

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership

		const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, governanceChannelId(state), state.channelPermissions)
		if (!canManageRoles)
			return res.status(403).json({ error: 'No permission to manage roles' })

		const role = state.roles[roleId]
		if (!role)
			return res.status(404).json({ error: 'Role not found' })
		if (role.isDefault)
			return res.status(400).json({ error: 'Default role cannot be deleted' })

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_delete',
			timestamp: Date.now(),
			content: { roleId },
		})
		res.status(200).json({})
	})

	router.put(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/roles\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const roleId = decodeURIComponent(req.params[1])
		const { permission, enabled, permissions: bulkPermissions } = req.body

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member } = membership
		const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, governanceChannelId(state), state.channelPermissions)
		if (!canManageRoles)
			return res.status(403).json({ error: 'No permission to manage roles' })

		const role = state.roles[roleId]
		if (!role) return res.status(404).json({ error: 'Role not found' })

		let updatedPermissions
		if (permission === 'bulk' && bulkPermissions)
			updatedPermissions = bulkPermissions
		else {
			updatedPermissions = { ...role.permissions }
			if (enabled) updatedPermissions[permission] = true
			else delete updatedPermissions[permission]
		}

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_update',
			timestamp: Date.now(),
			content: { roleId, updates: { permissions: updatedPermissions } },
		})
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/members\/([^/]+)\/(kick|ban|unban)$/, authenticate, async (req, res) => {
		const groupId = req.params[0]
		const targetMemberKey = decodeURIComponent(req.params[1])
		const action = req.params[2]

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, member, memberKey } = membership

		const governanceChannel = governanceChannelId(state)
		if (action === 'unban') {
			const canUnban = hasPermission(member, PERMISSIONS.BAN_MEMBERS, state.roles, governanceChannel, state.channelPermissions)
			if (!canUnban)
				return res.status(403).json({ error: 'No permission to unban members' })
			const resolvedTargetKey = resolveMemberKey(state, targetMemberKey)
			if (!resolvedTargetKey)
				return res.status(404).json({ error: 'Member not found' })
			const unbanMemberKey = resolvedTargetKey
			await appendSignedLocalEvent(username, groupId, {
				type: 'member_unban',
				timestamp: Date.now(),
				content: { targetMemberKey: unbanMemberKey },
			})
			const cleared = unbanTargetsFromMember(state, unbanMemberKey)
			/** @type {Array<{ scope: 'subject' | 'entity' | 'node', value: string }>} */
			const clearedEntries = []
			if (cleared.pubKeyHash) clearedEntries.push({ scope: 'subject', value: cleared.pubKeyHash })
			if (cleared.entityHash) clearedEntries.push({ scope: 'entity', value: cleared.entityHash })
			if (cleared.nodeHash) clearedEntries.push({ scope: 'node', value: cleared.nodeHash })
			for (const entry of clearedEntries)
				await removeGroupBlockedPeer(groupId, entry.scope, entry.value)
			return res.status(200).json({})
		}

		const resolvedTargetKey = resolveActiveMemberKey(state, targetMemberKey)
		if (!resolvedTargetKey)
			return res.status(404).json({ error: 'Member not found' })
		const resolvedMember = state.members[resolvedTargetKey]
		const requiredPermission = action === 'ban' ? PERMISSIONS.BAN_MEMBERS : PERMISSIONS.KICK_MEMBERS
		const isOwnerKickOwnAgent = action === 'kick'
			&& resolvedMember?.memberKind === 'agent'
			&& resolvedMember.ownerPubKeyHash === memberKey
		const isAdminKickAgent = action === 'kick'
			&& resolvedMember?.memberKind === 'agent'
			&& hasPermission(member, PERMISSIONS.ADMIN, state.roles, governanceChannel, state.channelPermissions)
		const canModerate = action === 'kick' && resolvedMember?.memberKind === 'agent'
			? isOwnerKickOwnAgent || isAdminKickAgent
			: hasPermission(member, requiredPermission, state.roles, governanceChannel, state.channelPermissions)
		if (!canModerate)
			return res.status(403).json({ error: 'No permission to moderate members' })
		if (resolvedTargetKey === memberKey && resolvedMember?.memberKind !== 'agent')
			return res.status(400).json({ error: 'Cannot moderate yourself' })

		if (action === 'ban') {
			const banScope = req.body?.banScope?.trim().toLowerCase()
			if (!isBanScope(banScope))
				return res.status(400).json({ error: 'banScope must be entity or node' })
			let banContent
			try {
				banContent = buildMemberBanContent(/** @type {import('../../chat/governance/banRules.mjs').BanScope} */ banScope, resolvedMember)
			}
			catch (error) {
				return res.status(400).json({ error: error.message })
			}
			await appendSignedLocalEvent(username, groupId, {
				type: 'member_ban',
				timestamp: Date.now(),
				content: banContent,
			})
			await addGroupBlockedPeers(groupId, blockEntriesFromBanContent(banContent))
			await addDenylistFromBanContent(banContent, groupId)
			return res.status(200).json({})
		}

		const content = { targetMemberKey: resolvedTargetKey }

		if (action === 'kick' && resolvedMember?.memberKind !== 'agent') {
			const keyEntry = await getCurrentFileMasterKey(username, groupId)
			if (keyEntry) {
				const nonce = generateKeyRotationNonce()
				const newGen = keyEntry.generation + 1
				content.key_generation = newGen
				content.new_key_nonce = nonce
				const kickEvent = await appendSignedLocalEvent(username, groupId, {
					type: 'member_kick',
					timestamp: Date.now(),
					content,
				})
				const newKey = deriveNextFileMasterKey(keyEntry.fileMasterKey, kickEvent.id, nonce)
				await appendFileMasterKey(username, groupId, newGen, newKey)
				await addGroupBlockedPeers(groupId, [{ scope: 'subject', value: resolvedTargetKey }])
				return res.status(200).json({})
			}
		}

		await appendSignedLocalEvent(username, groupId, {
			type: 'member_kick',
			timestamp: Date.now(),
			content,
		})
		const blockEntries = resolvedMember?.memberKind === 'agent'
			? [{ scope: 'entity', value: resolvedMember.agentEntityHash }]
			: [{ scope: 'subject', value: resolvedTargetKey }]
		await addGroupBlockedPeers(groupId, blockEntries)
		res.status(200).json({})
	})

	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/key-rotate$/, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext

		const activeCount = Object.values(state.members).filter(groupMember => groupMember?.status === 'active').length
		const governanceChannel = governanceChannelId(state)
		const perms = calculateMemberPermissions(member, state.roles, governanceChannel, state.channelPermissions)
		const isDmPair = activeCount === 2
		if (!isDmPair && !perms[PERMISSIONS.ADMIN] && !perms[PERMISSIONS.MANAGE_ROLES])
			return res.status(403).json({ error: 'key_rotate requires ADMIN or MANAGE_ROLES' })

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry)
			return res.status(400).json({ error: 'No file master key initialized for this group' })

		const nonce = generateKeyRotationNonce()
		const newGen = keyEntry.generation + 1
		const event = await appendKeyRotateEvent(username, groupId, {
			key_generation: newGen,
			new_key_nonce: nonce,
		})
		const newKey = deriveNextFileMasterKey(keyEntry.fileMasterKey, event.id, nonce)
		await appendFileMasterKey(username, groupId, newGen, newKey)
		res.status(200).json({ event, generation: newGen, maxGenerations: 64 })
	})

	/**
	 * 群主接替：由半数以上管理员联署选票，将 MANAGE_ADMINS 角色转移给新群主（§8）。
	 * body: `{ proposedOwnerPubKeyHash, ballotId, adminSignatures?, thresholdRatio? }`
	 *
	 * 已登录管理员提交时，服务端用本机 `local_signer_seed` 自动追加联署；亦可附带其他管理员的签名。
	 */
	router.post(/^\/api\/parts\/shells:chat\/groups\/([^/]+)\/owner-succession$/, authenticate, async (req, res) => {
		const groupId = req.params[0]

		const membership = await resolveGroupMember(req, res, groupId)
		if (!membership) return
		const { username, state, memberKey: callerKey } = membership

		const { proposedOwnerPubKeyHash, ballotId, adminSignatures, thresholdRatio: thresholdRaw } = req.body || {}

		if (!proposedOwnerPubKeyHash?.trim())
			return res.status(400).json({ error: 'proposedOwnerPubKeyHash required' })
		if (!ballotId?.trim())
			return res.status(400).json({ error: 'ballotId required' })

		const targetHash = proposedOwnerPubKeyHash.trim().toLowerCase()
		if (!resolveActiveMemberKey(state, targetHash))
			return res.status(400).json({ error: 'proposed owner is not an active member' })

		const adminHashes = adminPubKeyHashes(state)
		if (adminHashes.size === 0)
			return res.status(400).json({ error: 'group has no admins to vote' })

		const ballot = { proposedOwnerPubKeyHash: targetHash, groupId, ballotId: ballotId.trim() }
		const mergedSignatures = Array.isArray(adminSignatures) ? [...adminSignatures] : []
		const seenAdminHashes = new Set(
			mergedSignatures
				.map(entry => entry?.pubKeyHex?.trim().toLowerCase())
				.filter(isHex64)
				.map(hex => pubKeyHash(Buffer.from(hex, 'hex'))),
		)

		const callerAdminHash = callerKey
		if (adminHashes.has(callerAdminHash) && !seenAdminHashes.has(callerAdminHash))
			try {
				const local = await signOwnerSuccessionAsLocalAdmin(username, groupId, ballot)
				mergedSignatures.push(local)
				seenAdminHashes.add(pubKeyHash(Buffer.from(local.pubKeyHex, 'hex')))
			}
			catch (signError) {
				if (!mergedSignatures.length)
					return res.status(403).json({
						error: `Could not sign as admin: ${signError.message}`,
					})
			}


		if (!mergedSignatures.length)
			return res.status(403).json({ error: 'No admin signatures (caller is not admin or local signer unavailable)' })

		const thresholdRatio = Number(thresholdRaw) > 0 && Number(thresholdRaw) <= 1
			? Number(thresholdRaw)
			: adminHashes.size <= 1 ? 1 : 0.5

		const passed = await verifyOwnerSuccessionThreshold(
			{ ...ballot, adminSignatures: mergedSignatures },
			adminHashes,
			thresholdRatio,
		)
		if (!passed)
			return res.status(403).json({
				error: `succession ballot did not reach threshold (${thresholdRatio * 100}% of ${adminHashes.size} admin(s))`,
			})

		// 找出所有带 MANAGE_ADMINS 权限的角色
		const manageAdminsRoleIds = Object.entries(state.roles)
			.filter(([, role]) => role.permissions?.MANAGE_ADMINS)
			.map(([id]) => id)

		if (manageAdminsRoleIds.length === 0)
			return res.status(400).json({ error: 'no role with MANAGE_ADMINS found in this group' })

		// 选取转让角色：优先 'founder'，否则取第一个
		const transferRoleId = manageAdminsRoleIds.includes('founder') ? 'founder' : manageAdminsRoleIds[0]

		// 将转让角色赋给新群主（若其尚未持有）
		const newOwnerMember = state.members[targetHash]
		if (!(newOwnerMember?.roles || []).includes(transferRoleId))
			await appendSignedLocalEvent(username, groupId, {
				type: 'role_assign',
				timestamp: Date.now(),
				content: { targetMemberKey: targetHash, roleId: transferRoleId },
			})

		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { delegatedOwnerPubKeyHash: targetHash },
		})

		// 撤销当前其他 MANAGE_ADMINS 持有者（新群主除外）。
		// 关键顺序：先完成 owner 迁移，再撤销旧 owner；避免在中途丢失写权限导致 500。
		const revocations = []
		for (const [key, member] of Object.entries(state.members)) {
			if (member?.status !== 'active') continue
			const hash = String(key || '').trim().toLowerCase()
			if (!hash || hash === targetHash) continue
			for (const roleId of member.roles || [])
				if (state.roles[roleId]?.permissions?.MANAGE_ADMINS)
					revocations.push({ targetMemberKey: hash, roleId })
		}
		revocations.sort((a, b) => {
			const aIsCaller = a.targetMemberKey === callerKey
			const bIsCaller = b.targetMemberKey === callerKey
			return Number(aIsCaller) - Number(bIsCaller)
		})
		for (const revoke of revocations) {
			// 最后一笔通常是调用者自撤权；提交后会触发 role 侧效（含 rotateAllChannelKeys）。
			// 若立刻按新权限执行该侧效，会在“事件已落盘后”抛 MANAGE_CHANNELS，导致误报 500。
			const appendOpts = revoke.targetMemberKey === callerKey
				? { skipReleaseQuarantined: true, skipGenesisSideEffects: true }
				: undefined
			await appendSignedLocalEvent(username, groupId, {
				type: 'role_revoke',
				timestamp: Date.now(),
				content: revoke,
			}, appendOpts)
		}

		res.status(200).json({ newOwnerPubKeyHash: targetHash, transferRoleId })
	})

	registerGroupFileRoutes(router, authenticate, getUserByReq, getState, canInChannel, PERMISSIONS)
}

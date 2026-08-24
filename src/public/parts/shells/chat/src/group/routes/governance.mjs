/**
 * 【文件】group/routes/governance.mjs
 * 【职责】群治理 HTTP：角色/频道权限、踢禁、密钥轮换、群主接替及群文件路由挂载。
 * 【原理】读权限用 calculateMemberPermissions；写操作 appendSignedLocalEvent；ban 联动 blocklist/peers；owner-succession 校验管理员联署阈值后 role_assign/revoke。
 * 【数据结构】扁平 permissions map、roleId/channelId、banScope、owner succession ballot/adminSignatures。
 * 【关联】被 group/endpoints.mjs 注册；依赖 chat/governance/*、chat/files/groupFiles、access.mjs。
 */
import { Buffer } from 'node:buffer'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { pubKeyHash } from 'npm:@steve02081504/fount-p2p/crypto'
import { generateKeyRotationNonce, deriveNextFileMasterKey } from 'npm:@steve02081504/fount-p2p/crypto/key'
import { verifyOwnerSuccessionThreshold } from 'npm:@steve02081504/fount-p2p/governance/owner_succession_ballot'
import { addDenylistFromBanContent, addGroupBlockedPeers, removeGroupBlockedPeer } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { applyVolatileSlashAlert, buildUnverifiedSlashAlert } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { calculateMemberPermissions, GROUP_SCOPE_ID, PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'


import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { appendKeyRotateEvent } from '../../chat/dag/channelOperations.mjs'
import { adminPubKeyHashes, effectiveChannelPermissions, effectiveGroupPermissions } from '../../chat/dag/groupMaterializedState.mjs'
import { resolveLocalEventSigner } from '../../chat/dag/localSigner.mjs'
import { getState } from '../../chat/dag/materialize.mjs'
import { publishVolatileToFederation } from '../../chat/federation/index.mjs'
import { invalidateFederationRoomCache } from '../../chat/federation/room.mjs'
import { mintRoomSecret } from '../../chat/federation/roomCredentials.mjs'
import { getCurrentFileMasterKey, appendFileMasterKey } from '../../chat/file_keys/store.mjs'
import {
	blockEntriesFromBanContent,
	buildMemberBanContent,
	isBanScope,
	unbanTargetsFromMember,
} from '../../chat/governance/banRules.mjs'
import { signOwnerSuccessionAsLocalAdmin } from '../../chat/governance/ownerSuccessionSign.mjs'
import { broadcastEvent } from '../../chat/ws/groupWsBroadcast.mjs'
import { groupWsRoomKeyForReplica } from '../../chat/ws/groupWsRooms.mjs'
import {
	canGovSlash,
	canInChannel,
	governanceChannelId,
	resolveActiveMemberKey,
	resolveActiveMemberKeyForLocalUser,
	resolveMemberKey,
} from '../access.mjs'

import { registerGroupFileRoutes } from './groupFilesRoutes.mjs'
import { requireGroupMember, resolveGroupMember } from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * 治理操作后轮换 roomSecret 并失效 federation room 缓存。
 * @param {string} username 登录名
 * @param {string} groupId 群 id
 * @returns {Promise<void>}
 */
async function rotateRoomSecretAfterModeration(username, groupId) {
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: { roomSecret: mintRoomSecret() },
	})
	invalidateFederationRoomCache(username, groupId)
}

/**
 * 注册权限/治理/成员管理相关 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerGovernanceRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/permissions`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { groupId } = req.params
		const subject = (req.query.pubKeyHash || '').trim()
		const channelId = (req.query.channelId || '').trim() || 'default'

		const { state } = await getState(username, groupId)
		let resolvedKey = subject ? resolveActiveMemberKey(state, subject) : null
		if (!resolvedKey)
			resolvedKey = await resolveActiveMemberKeyForLocalUser(username, groupId, state)
		if (!resolvedKey)
			throw httpError(403, 'Not a member')
		const member = state.members[resolvedKey]
		if (!state.channels[channelId])
			throw httpError(404, 'Channel not found')

		const channelFlat = calculateMemberPermissions(member, state.roles, channelId, effectiveChannelPermissions(state, channelId))
		const groupFlat = calculateMemberPermissions(member, state.roles, GROUP_SCOPE_ID, effectiveGroupPermissions(state))
		res.status(200).json({ ...groupFlat, ...channelFlat })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/permissions`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupContext: { state, member }, params: { channelId } } = req
		if (!state.channels[channelId])
			throw httpError(404, 'Channel not found')

		const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
		const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
		if (!canView && !canManageChannels)
			throw httpError(403, 'No permission to view channel permissions')

		const { resolvePermissionBlockOwner } = await import('../../chat/dag/groupMaterializedState.mjs')
		const ownerId = resolvePermissionBlockOwner(state, channelId)
		const permissions = ownerId ? state.channelPermissions?.[ownerId] || {} : {}
		res.status(200).json({ permissions, permissionBlockId: state.channels[channelId]?.permissionBlockId || null })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId/permissions`, authenticate, requireGroupMember(), async (req, res) => {
		const { params: { channelId }, body: { roleId, allow, deny } } = req
		if (!roleId)
			throw httpError(400, 'roleId is required')

		const { username, state, member, groupId } = req.groupContext
		if (!state.channels[channelId])
			throw httpError(404, 'Channel not found')
		if (!state.roles[roleId])
			throw httpError(404, 'Role not found')

		const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
		if (!canManageChannels)
			throw httpError(403, 'No permission to manage channels')

		// 已同步（强引用父块）的频道单独设权限时先脱钩：channel_update 会复制当前有效块进自有覆写。
		if (state.channels[channelId]?.permissionBlockId)
			await appendSignedLocalEvent(username, groupId, {
				type: 'channel_update',
				timestamp: Date.now(),
				content: { channelId, updates: { permissionBlockId: null } },
			})

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_permissions_update',
			timestamp: Date.now(),
			content: { channelId, roleId, allow, deny },
		})
		res.status(200).json({})
	})

	// 一键同步：子频道权限块强引用父频道块（body.permissionBlockId 为父频道 id，缺省为根频道）。
	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId/permissions/sync`, authenticate, requireGroupMember(), async (req, res) => {
		const { params: { channelId }, body: { permissionBlockId } } = req
		const { username, state, member, groupId } = req.groupContext
		if (!state.channels[channelId])
			throw httpError(404, 'Channel not found')
		const target = permissionBlockId || state.groupSettings?.rootChannelId || null
		if (target && !state.channels[target])
			throw httpError(404, 'Target channel not found')
		if (target === channelId)
			throw httpError(400, 'permissionBlockId cannot reference self')
		if (target) {
			const { resolvePermissionBlockOwner } = await import('../../chat/dag/groupMaterializedState.mjs')
			if (resolvePermissionBlockOwner(state, target) === channelId)
				throw httpError(400, 'permissionBlockId forms a cycle')
		}
		if (!canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId))
			throw httpError(403, 'No permission to manage channels')

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_update',
			timestamp: Date.now(),
			content: { channelId, updates: { permissionBlockId: target } },
		})
		res.status(200).json({ permissionBlockId: target })
	})

	router.get(`${GROUPS_PREFIX}/:groupId/group-permissions`, authenticate, requireGroupMember(), async (req, res) => {
		const { groupContext: { state, member } } = req
		if (!canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state)))
			throw httpError(403, 'No permission to view group permissions')
		res.status(200).json({ permissions: state.groupPermissions || {} })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/group-permissions`, authenticate, requireGroupMember(), async (req, res) => {
		const { params: { groupId }, body: { roleId, allow, deny } } = req
		if (!roleId)
			throw httpError(400, 'roleId is required')
		const { username, state, member } = req.groupContext
		if (!state.roles[roleId])
			throw httpError(404, 'Role not found')
		if (!canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state)))
			throw httpError(403, 'No permission to manage group permissions')

		await appendSignedLocalEvent(username, groupId, {
			type: 'group_permissions_update',
			timestamp: Date.now(),
			content: { roleId, allow, deny },
		})
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/roles`, authenticate, requireGroupMember(), async (req, res) => {
		const {
			body: { name, color },
			groupContext: { username, state, member, groupId }
		} = req

		const canManageRoles = canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state))
		if (!canManageRoles)
			throw httpError(403, 'No permission to manage roles')

		const roleName = name?.trim()
		if (!roleName)
			throw httpError(400, 'Role name is required')
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

	router.put(`${GROUPS_PREFIX}/:groupId/roles/:roleId`, authenticate, async (req, res) => {
		const { groupId, roleId: roleIdRaw } = req.params
		const roleId = decodeURIComponent(roleIdRaw)
		const { name, color, position, isHoisted } = req.body

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership

		const canManageRoles = canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state))
		if (!canManageRoles)
			throw httpError(403, 'No permission to manage roles')

		const role = state.roles[roleId]
		if (!role) throw httpError(404, 'Role not found')

		const updates = {}
		const roleName = name?.trim()
		if (roleName) updates.name = roleName
		const roleColor = color?.trim()
		if (roleColor) updates.color = roleColor
		if (Number.isFinite(position)) updates.position = position
		if (isHoisted != null) updates.isHoisted = !!isHoisted
		if (!Object.keys(updates).length)
			throw httpError(400, 'No updatable fields provided')

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_update',
			timestamp: Date.now(),
			content: { roleId, updates },
		})
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/roles/:roleId`, authenticate, async (req, res) => {
		const { groupId, roleId: roleIdRaw } = req.params
		const roleId = decodeURIComponent(roleIdRaw)

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership

		const canManageRoles = canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state))
		if (!canManageRoles)
			throw httpError(403, 'No permission to manage roles')

		const role = state.roles[roleId]
		if (!role)
			throw httpError(404, 'Role not found')
		if (role.isDefault)
			throw httpError(400, 'Default role cannot be deleted')

		await appendSignedLocalEvent(username, groupId, {
			type: 'role_delete',
			timestamp: Date.now(),
			content: { roleId },
		})
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/roles/:roleId/permissions`, authenticate, async (req, res) => {
		const { groupId, roleId: roleIdRaw } = req.params
		const roleId = decodeURIComponent(roleIdRaw)
		const { permission, enabled, permissions: bulkPermissions } = req.body

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		const canManageRoles = canInChannel(state, member, PERMISSIONS.MANAGE_ROLES, governanceChannelId(state))
		if (!canManageRoles)
			throw httpError(403, 'No permission to manage roles')

		const role = state.roles[roleId]
		if (!role) throw httpError(404, 'Role not found')

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

	router.post(`${GROUPS_PREFIX}/:groupId/members/:memberKey/:action`, authenticate, async (req, res) => {
		const { groupId, action } = req.params
		if (!['kick', 'ban', 'unban'].includes(action))
			throw httpError(404, 'Unknown member action')
		const targetMemberKey = decodeURIComponent(req.params.memberKey)

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member, memberKey } = membership

		const governanceChannel = governanceChannelId(state)
		if (action === 'unban') {
			const canUnban = canInChannel(state, member, PERMISSIONS.BAN_MEMBERS, governanceChannel)
			if (!canUnban)
				throw httpError(403, 'No permission to unban members')
			const resolvedTargetKey = resolveMemberKey(state, targetMemberKey)
			if (!resolvedTargetKey)
				throw httpError(404, 'Member not found')
			await appendSignedLocalEvent(username, groupId, {
				type: 'member_unban',
				timestamp: Date.now(),
				content: { targetMemberKey: resolvedTargetKey },
			})
			const cleared = unbanTargetsFromMember(state, resolvedTargetKey)
			/** @type {Array<{ scope: 'subject' | 'entity' | 'node', value: string }>} */
			const clearedEntries = []
			if (cleared.pubKeyHash) clearedEntries.push({ scope: 'subject', value: cleared.pubKeyHash })
			if (cleared.entityHash) clearedEntries.push({ scope: 'entity', value: cleared.entityHash })
			if (cleared.nodeHash) clearedEntries.push({ scope: 'node', value: cleared.nodeHash })
			for (const entry of clearedEntries)
				await removeGroupBlockedPeer(groupId, entry.scope, entry.value)
			return res.status(200).json({})
		}

		if (action === 'ban') {
			const resolvedTargetKey = resolveMemberKey(state, targetMemberKey)
			if (!resolvedTargetKey)
				throw httpError(404, 'Member not found')
			const resolvedMember = state.members[resolvedTargetKey]
			if (!canInChannel(state, member, PERMISSIONS.BAN_MEMBERS, governanceChannel))
				throw httpError(403, 'No permission to moderate members')
			if (resolvedTargetKey === memberKey && resolvedMember?.memberKind !== 'agent')
				throw httpError(400, 'Cannot moderate yourself')
			// 已封禁：幂等返回，避免重试再追加 member_ban / 再扣声誉
			if (resolvedMember?.status === 'banned')
				return res.status(200).json({ banned: true, reputationSlash: { ok: true, alreadyBanned: true } })
			if (resolvedMember?.status !== 'active')
				throw httpError(404, 'Member not found')

			const banScope = req.body?.banScope?.trim()
			if (!isBanScope(banScope))
				throw httpError(400, 'banScope must be entity or node')
			let banContent
			try {
				banContent = buildMemberBanContent(/** @type {import('../../chat/governance/banRules.mjs').BanScope} */ banScope, resolvedMember)
			}
			catch (error) {
				throw httpError(400, error.message)
			}
			const banEvent = await appendSignedLocalEvent(username, groupId, {
				type: 'member_ban',
				timestamp: Date.now(),
				content: banContent,
			})
			await rotateRoomSecretAfterModeration(username, groupId)
			await addGroupBlockedPeers(groupId, blockEntriesFromBanContent(banContent))
			await addDenylistFromBanContent(banContent, groupId)

			/** @type {{ ok: boolean, error?: string, banEventId?: string }} */
			let reputationSlash = { ok: true, banEventId: banEvent.id }
			try {
				if (!canGovSlash(state, member))
					throw new Error('ADMIN or MANAGE_ROLES required')
				const { sender } = await resolveLocalEventSigner(username, groupId)
				const alert = buildUnverifiedSlashAlert(
					sender,
					{ targetPubKeyHash: resolvedTargetKey, claim: 1 },
					state.groupSettings || {},
				)
				// 用 ban 事件 id 锚定 alert，重试同一 ban 时 volatile 侧可按 banEventId 去重
				alert.banEventId = banEvent.id
				await applyVolatileSlashAlert(alert)
				broadcastEvent(groupWsRoomKeyForReplica(groupId), alert)
				await publishVolatileToFederation(groupId, alert)
			}
			catch (error) {
				reputationSlash = { ok: false, error: error.message, banEventId: banEvent.id }
			}
			return res.status(200).json({ banned: true, reputationSlash })
		}

		const resolvedTargetKey = resolveActiveMemberKey(state, targetMemberKey)
		if (!resolvedTargetKey)
			throw httpError(404, 'Member not found')
		const resolvedMember = state.members[resolvedTargetKey]
		const callerEntity = String(member?.entityHash || '').trim()
		const ownerEntity = String(resolvedMember?.ownerEntityHash || '').trim()
		const isOwnerKickOwnAgent = resolvedMember?.memberKind === 'agent'
			&& !!(ownerEntity && callerEntity === ownerEntity)
		const isAdminKickAgent = resolvedMember?.memberKind === 'agent'
			&& canInChannel(state, member, PERMISSIONS.ADMIN, governanceChannel)
		const canModerate = resolvedMember?.memberKind === 'agent'
			? isOwnerKickOwnAgent || isAdminKickAgent
			: canInChannel(state, member, PERMISSIONS.KICK_MEMBERS, governanceChannel)
		if (!canModerate)
			throw httpError(403, 'No permission to moderate members')
		if (resolvedTargetKey === memberKey && resolvedMember?.memberKind !== 'agent')
			throw httpError(400, 'Cannot moderate yourself')

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
				await rotateRoomSecretAfterModeration(username, groupId)
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
		await rotateRoomSecretAfterModeration(username, groupId)
		const blockEntries = resolvedMember?.memberKind === 'agent'
			? [{ scope: 'entity', value: resolvedMember.entityHash }]
			: [{ scope: 'subject', value: resolvedTargetKey }]
		await addGroupBlockedPeers(groupId, blockEntries)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/file-key-rotate`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, member, groupId } = req.groupContext

		const activeCount = Object.values(state.members).filter(groupMember => groupMember?.status === 'active').length
		const governanceChannel = governanceChannelId(state)
		const isDmPair = activeCount === 2
		if (!isDmPair && !canInChannel(state, member, [PERMISSIONS.ADMIN, PERMISSIONS.MANAGE_ROLES], governanceChannel))
			throw httpError(403, 'file_master_key_rotate requires ADMIN or MANAGE_ROLES')

		const keyEntry = await getCurrentFileMasterKey(username, groupId)
		if (!keyEntry)
			throw httpError(400, 'No file master key initialized for this group')

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
	router.post(`${GROUPS_PREFIX}/:groupId/owner-succession`, authenticate, async (req, res) => {
		const { groupId } = req.params

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, memberKey: callerKey } = membership

		const { proposedOwnerPubKeyHash, ballotId, adminSignatures, thresholdRatio: thresholdRaw } = req.body

		if (!proposedOwnerPubKeyHash?.trim())
			throw httpError(400, 'proposedOwnerPubKeyHash required')
		if (!ballotId?.trim())
			throw httpError(400, 'ballotId required')

		const targetHash = proposedOwnerPubKeyHash.trim()
		if (!resolveActiveMemberKey(state, targetHash))
			throw httpError(400, 'proposed owner is not an active member')

		const adminHashes = adminPubKeyHashes(state)
		if (adminHashes.size === 0)
			throw httpError(400, 'group has no admins to vote')

		const ballot = { proposedOwnerPubKeyHash: targetHash, groupId, ballotId: ballotId.trim() }
		const mergedSignatures = Array.isArray(adminSignatures) ? [...adminSignatures] : []
		const seenAdminHashes = new Set(
			mergedSignatures
				.map(entry => entry?.pubKeyHex?.trim())
				.filter(isHex64)
				.map(hex => pubKeyHash(Buffer.from(hex, 'hex'))),
		)

		if (adminHashes.has(callerKey) && !seenAdminHashes.has(callerKey))
			try {
				const local = await signOwnerSuccessionAsLocalAdmin(username, groupId, ballot)
				mergedSignatures.push(local)
				seenAdminHashes.add(pubKeyHash(Buffer.from(local.pubKeyHex, 'hex')))
			}
			catch (signError) {
				if (!mergedSignatures.length)
					throw httpError(403, `Could not sign as admin: ${signError.message}`)
			}


		if (!mergedSignatures.length)
			throw httpError(403, 'No admin signatures (caller is not admin or local signer unavailable)')

		const thresholdRatio = Number(thresholdRaw) > 0 && Number(thresholdRaw) <= 1
			? Number(thresholdRaw)
			: adminHashes.size <= 1 ? 1 : 0.5

		const passed = await verifyOwnerSuccessionThreshold(
			{ ...ballot, adminSignatures: mergedSignatures },
			adminHashes,
			thresholdRatio,
		)
		if (!passed)
			throw httpError(403, `succession ballot did not reach threshold (${thresholdRatio * 100}% of ${adminHashes.size} admin(s))`)

		// 找出所有带 MANAGE_ADMINS 权限的角色
		const manageAdminsRoleIds = Object.entries(state.roles)
			.filter(([, role]) => role.permissions?.MANAGE_ADMINS)
			.map(([id]) => id)

		if (manageAdminsRoleIds.length === 0)
			throw httpError(400, 'no role with MANAGE_ADMINS found in this group')

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
			const hash = key || ''
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
			const appendOptions = revoke.targetMemberKey === callerKey
				? { skipReleaseQuarantined: true, skipGenesisSideEffects: true }
				: undefined
			await appendSignedLocalEvent(username, groupId, {
				type: 'role_revoke',
				timestamp: Date.now(),
				content: revoke,
			}, appendOptions)
		}

		res.status(200).json({ newOwnerPubKeyHash: targetHash, transferRoleId })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/cabinets/bind`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, memberKey } = await resolveGroupMember(req, res, req.params.groupId)
		const member = state.members[memberKey]
		const gov = governanceChannelId(state)
		if (!canInChannel(state, member, [PERMISSIONS.ADMIN, PERMISSIONS.MANAGE_ADMINS], gov))
			throw httpError(403, 'ADMIN or MANAGE_ADMINS required')
		const { body } = req
		if (!body.cabinet_id) throw httpError(400, 'cabinet_id required')
		const { appendCabinetBind } = await import('../../chat/cabinets/keys.mjs')
		const event = await appendCabinetBind(username, req.params.groupId, {
			cabinet_id: String(body.cabinet_id),
			name: body.name,
			write_pubkey: body.write_pubkey,
			role_access: body.role_access,
		})
		res.status(201).json({ event })
	})

	router.post(`${GROUPS_PREFIX}/:groupId/cabinets/unbind`, authenticate, requireGroupMember(), async (req, res) => {
		const { username, state, memberKey } = await resolveGroupMember(req, res, req.params.groupId)
		const member = state.members[memberKey]
		const gov = governanceChannelId(state)
		if (!canInChannel(state, member, [PERMISSIONS.ADMIN, PERMISSIONS.MANAGE_ADMINS], gov))
			throw httpError(403, 'ADMIN or MANAGE_ADMINS required')
		const cabinetId = req.body.cabinet_id || ''
		if (!cabinetId) throw httpError(400, 'cabinet_id required')
		const { appendCabinetUnbind } = await import('../../chat/cabinets/keys.mjs')
		const event = await appendCabinetUnbind(username, req.params.groupId, cabinetId)
		res.status(200).json({ event })
	})

	registerGroupFileRoutes(router, authenticate, getUserByReq, getState, canInChannel, PERMISSIONS)
}

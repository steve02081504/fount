/**
 * 【文件】group/routes/channelCrud.mjs
 * 【职责】频道 HTTP 路由（频道与群元数据 CRUD）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { prefixedRandomId } from '../../../../../../../scripts/p2p/random_id.mjs'
import { normalizeFriendBinding } from '../../../public/src/friendBinding.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'

import {
	ensureChannel,
	requireGroupMember,
	resolveGroupMember,
} from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'


/**
 * 注册频道 频道与群元数据 CRUD HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelCrudRoutes(router, authenticate) {
	router.put(`${GROUPS_PREFIX}/:groupId/default-channel`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const channelId = String(req.body?.channelId || '').trim()
		if (!channelId)
			throw httpError(400, 'channelId required')

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: { defaultChannelId: channelId },
		})
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/meta`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { name, description, friendBinding } = req.body || {}
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		/** @type {Record<string, unknown>} */
		const content = {}
		if (name !== undefined) content.name = name
		if (description !== undefined) content.description = description ?? ''
		if (friendBinding !== undefined) 
			if (friendBinding === null)
				content.friendBinding = null
			else {
				const normalized = normalizeFriendBinding(friendBinding)
				if (!normalized)
					throw httpError(400, 'invalid friendBinding')
				content.friendBinding = normalized
			}
		

		if (!Object.keys(content).length)
			throw httpError(400, 'no meta fields to update')
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_meta_update',
			timestamp: Date.now(),
			content,
		})
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/settings`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username } = membership
		const { delegatedOwnerPubKeyHash, ...settingsPatch } = req.body || {}
		await appendSignedLocalEvent(username, groupId, {
			type: 'group_settings_update',
			timestamp: Date.now(),
			content: settingsPatch,
		})
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels`, authenticate, requireGroupMember(), async (req, res) => {
		const {
			groupContext: { username, groupId },
			body: { type, name, description, isPrivate }
		} = req
		const channelName = String(name || '').trim()
		if (!channelName)
			throw httpError(400, 'Channel name is required')

		const channelId = prefixedRandomId('channel_')
		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_create',
			timestamp: Date.now(),
			content: {
				channelId,
				type: type || 'text',
				name: channelName,
				description: description ?? '',
				isPrivate: isPrivate || false,
			},
		})
		res.status(201).json({ channelId })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { name, description, type, isPrivate, parentChannelId } = req.body

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const updates = {}
		if (name !== undefined) {
			const trimmed = String(name).trim()
			if (!trimmed)
				throw httpError(400, 'Channel name cannot be empty')
			updates.name = trimmed
		}
		if (description !== undefined)
			updates.description = String(description)
		if (type !== undefined)
			updates.type = type
		if (isPrivate !== undefined)
			updates.isPrivate = Boolean(isPrivate)
		if (parentChannelId !== undefined)
			updates.parentChannelId = parentChannelId || null

		if (Object.keys(updates).length === 0)
			throw httpError(400, 'No channel updates provided')

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_update',
			timestamp: Date.now(),
			content: { channelId, updates },
		})
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/channels/:channelId`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		if (state.groupSettings.defaultChannelId === channelId)
			throw httpError(400, 'Cannot delete default channel')

		await appendSignedLocalEvent(username, groupId, {
			type: 'channel_delete',
			timestamp: Date.now(),
			content: { channelId },
		})
		res.status(200).json({ channelId, deleted: true })
	})

}

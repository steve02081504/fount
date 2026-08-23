/**
 * 【文件】group/routes/channelCrud.mjs
 * 【职责】频道 HTTP 路由（频道与群元数据 CRUD）。
 * 【关联】被 channels.mjs 聚合注册。
 */
import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { appendSignedLocalEvent } from '../../chat/dag/append.mjs'
import { chatClientFromReq } from '../../endpoints/shared.mjs'
import { materializeFriendBinding } from '../lib/friendBinding.mjs'

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
				const materialized = await materializeFriendBinding(username, friendBinding)
				if (!materialized)
					throw httpError(400, 'invalid friendBinding')
				content.friendBinding = materialized
			}


		if (!Object.keys(content).length)
			throw httpError(400, 'no meta fields to update')
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).setMeta(content)
		res.status(200).json(
			content.friendBinding !== undefined ? { friendBinding: content.friendBinding } : {},
		)
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
			groupContext: { groupId, state },
			body: { type, name, description, isPrivate, parentChannelId }
		} = req
		const channelName = name ?? ''
		if (parentChannelId) ensureChannel(state, parentChannelId)

		const { client } = await chatClientFromReq(req)
		const channel = await (await client.group(groupId)).createChannel({
			type: type || 'text',
			name: channelName,
			description: description ?? '',
			channelId: prefixedRandomId('channel_'),
			isPrivate: isPrivate || false,
			parentChannelId: parentChannelId || null,
			permBlockId: parentChannelId || state.groupSettings?.defaultChannelId || null,
		})
		res.status(201).json({ channelId: channel.id })
	})

	router.put(`${GROUPS_PREFIX}/:groupId/channels/:channelId`, authenticate, async (req, res) => {
		const { params: { groupId, channelId }, body: { name, description, type, isPrivate, links, permBlockId } } = req

		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state } = membership
		ensureChannel(state, channelId)

		const updates = {}
		if (name !== undefined) {
			const trimmed = name
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
		if (links !== undefined) {
			if (!Array.isArray(links))
				throw httpError(400, 'links must be an array of channel ids')
			for (const linkId of links)
				ensureChannel(state, linkId)
			if (links.includes(channelId))
				throw httpError(400, 'links cannot reference self')
			// 环检测：沿 links 从本频道可达处遍历，若回到本频道则拒绝，防止互链成环。
			const seen = new Set()
			const stack = [...links]
			while (stack.length) {
				const id = stack.pop()
				if (id === channelId)
					throw httpError(400, 'links form a cycle')
				if (seen.has(id)) continue
				seen.add(id)
				stack.push(...state.channels?.[id]?.links || [])
			}
			updates.links = links
		}
		if (permBlockId !== undefined) {
			const target = permBlockId || null
			if (target) {
				ensureChannel(state, target)
				if (target === channelId)
					throw httpError(400, 'permBlockId cannot reference self')
				// 环检测：沿 permBlockId 从 target 上溯，若回到本频道则成环。
				let cursor = target
				const seen = new Set()
				while (cursor && !seen.has(cursor)) {
					if (cursor === channelId)
						throw httpError(400, 'permBlockId forms a cycle')
					seen.add(cursor)
					cursor = state.channels?.[cursor]?.permBlockId || null
				}
			}
			updates.permBlockId = target
		}

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
		// 频道被删除 → 立即清理该频道草稿及其附件内容
		const { client } = await chatClientFromReq(req)
		const { removedFileIds } = await client.drafts.remove(`${groupId}:${channelId}`)
		if (removedFileIds.length) await client.draftContents.removeMany(removedFileIds)
		res.status(200).json({ channelId, deleted: true })
	})

}

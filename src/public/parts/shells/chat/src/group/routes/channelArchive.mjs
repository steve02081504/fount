/**
 * 【文件】group/routes/channelArchive.mjs
 * 【职责】频道完整归档 HTTP：GET export、POST import（multipart JSON）。
 * 【原理】export 需 VIEW_CHANNEL；import 需 MANAGE_CHANNELS，新建 text 频道后 backfill 写入。
 * 【关联】channelArchive.mjs、channels.mjs、upload/fromRequest。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import {
	exportChannelArchive,
	importChannelArchive,
	validateChannelArchive,
} from '../../chat/channelArchive.mjs'
import { pickUploadedFile } from '../../upload/fromRequest.mjs'

import {
	ensureCanInChannel,
	ensureChannel,
	resolveGroupMember,
} from './middleware.mjs'
import { GROUPS_PREFIX } from './path.mjs'

/**
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelArchiveRoutes(router, authenticate) {
	router.get(`${GROUPS_PREFIX}/:groupId/channels/:channelId/export`, authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		ensureChannel(state, channelId)
		ensureCanInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
		res.status(200).json(await exportChannelArchive(username, groupId, channelId))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/channels/import`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const membership = await resolveGroupMember(req, res, groupId)
		const { username, state, member } = membership
		const defaultChannelId = state.groupSettings?.defaultChannelId
			|| Object.keys(state.channels || {})[0]
			|| 'default'
		ensureCanInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, defaultChannelId)

		const file = pickUploadedFile(req, 'archive')
		let archive
		if (file?.buffer?.length) 
			try {
				archive = JSON.parse(file.buffer.toString('utf8'))
			}
			catch {
				throw httpError(400, 'Invalid archive JSON')
			}
		
		else if (req.body?.archive && typeof req.body.archive === 'object')
			archive = req.body.archive
		else if (req.body?.format === 'fount-channel-archive')
			archive = req.body
		else
			throw httpError(400, 'archive file or JSON body required')

		try {
			validateChannelArchive(archive)
		}
		catch (error) {
			throw httpError(400, error.message)
		}

		const name = req.body?.name != null ? String(req.body.name) : undefined
		const description = req.body?.description != null ? String(req.body.description) : undefined
		const result = await importChannelArchive(username, groupId, archive, { name, description })
		res.status(201).json(result)
	})
}

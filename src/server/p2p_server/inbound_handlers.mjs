import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'
import {
	registerDeliveryInboundHandler,
	registerRpcInboundHandler,
} from 'npm:@steve02081504/fount-p2p/registries/inbound'
import { isPartInvokeResponse } from 'npm:@steve02081504/fount-p2p/wire/part/invoke'

import { getAllUserNames } from '../auth/index.mjs'
import { loadPart, hasPartMain } from '../parts_loader.mjs'

/**
 * @param {string} username 目标用户
 * @param {string} partpath part 路径（wire 入站已校验）
 * @param {object} data 调用载荷
 * @param {{ requesterNodeHash?: string | null }} ingress 入站元数据
 * @returns {Promise<import('npm:@steve02081504/fount-p2p/wire/part/invoke').PartInvokeResponse | null>} 部件响应
 */
async function invokePartForUser(username, partpath, data, ingress = {}) {
	if (!isPlainObject(data)) return null
	if (!hasPartMain(username, partpath)) return null
	let part
	try {
		part = await loadPart(username, partpath)
	}
	catch (err) {
		console.error('p2p: part_invoke loadPart failed', { partpath, err })
		return { error: { message: 'load_failed', code: 'LOAD_FAILED' } }
	}
	const handler = part?.interfaces?.invokes?.P2PInvokeHandler
	if (!handler) return null
	try {
		const response = await handler(username, data, ingress)
		if (response == null) return null
		if (!isPartInvokeResponse(response))
			throw new Error('P2PInvokeHandler must return { result } or { error: { message, code } }')
		return response
	}
	catch (err) {
		console.error('p2p: P2PInvokeHandler failed', { partpath, err })
		return {
			error: {
				message: err instanceof Error ? err.message : 'handler_failed',
				code: 'HANDLER_FAILED',
			},
		}
	}
}

/**
 * @param {string} [preferredUsername] 首选 replica
 * @param {string} partpath part 路径
 * @returns {Promise<string | null>} 拥有该 part 的用户名
 */
export async function resolveUsernameForPartpath(preferredUsername, partpath) {
	if (preferredUsername && hasPartMain(preferredUsername, partpath)) return preferredUsername
	for (const username of getAllUserNames())
		if (hasPartMain(username, partpath)) return username
	return null
}

/**
 * @returns {void}
 */
export function registerP2PInboundHandlers() {
	registerRpcInboundHandler('part_invoke', async (ctx, message) => {
		// partpath 已在 wire/part ingress 校验
		const { partpath } = message
		if (!partpath || !isPlainObject(message.invoke)) return null
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return null
		return invokePartForUser(username, partpath, message.invoke, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
	})

	registerDeliveryInboundHandler('part_timeline_put', async (ctx, message) => {
		const { partpath } = message
		if (!partpath) return
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return
		await invokePartForUser(username, partpath, { kind: 'timeline_put', ...message }, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
	})
}

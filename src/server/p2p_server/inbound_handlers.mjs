import {
	registerDeliveryInboundHandler,
	registerRpcInboundHandler,
} from 'npm:@steve02081504/fount-p2p/registries/inbound'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'
import { isPartInvokeResponse, normalizePartpath } from 'npm:@steve02081504/fount-p2p/wire/part_invoke'

import { getAllUserNames } from '../auth/index.mjs'
import { loadPart, hasPartMain } from '../parts_loader.mjs'

/**
 * @param {string} username 目标用户
 * @param {string} partpath part 路径
 * @param {object} data 调用载荷
 * @param {{ requesterNodeHash?: string | null }} ingress 入站元数据
 * @returns {Promise<import('npm:@steve02081504/fount-p2p/wire/part_invoke').PartInvokeResponse | null>} 部件响应
 */
async function invokePartForUser(username, partpath, data, ingress = {}) {
	const path = normalizePartpath(partpath)
	if (!path || !isPlainObject(data)) return null
	if (!hasPartMain(username, path)) return null
	let part
	try {
		part = await loadPart(username, path)
	}
	catch (err) {
		console.error('p2p: part_invoke loadPart failed', { partpath: path, err })
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
		console.error('p2p: P2PInvokeHandler failed', { partpath: path, err })
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
async function resolveUsernameForPartpath(preferredUsername, partpath) {
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
		const partpath = normalizePartpath(message.partpath)
		if (!partpath || !isPlainObject(message.invoke)) return null
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return null
		return invokePartForUser(username, partpath, message.invoke, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
	})

	registerDeliveryInboundHandler('part_timeline_put', async (ctx, message) => {
		const partpath = normalizePartpath(message.partpath)
		if (!partpath) return
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return
		await invokePartForUser(username, partpath, { kind: 'timeline_put', ...message }, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
	})
}

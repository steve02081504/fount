import { registerInboundHandler } from '../../scripts/p2p/inbound_registry.mjs'
import { isPartInvokeResponse, normalizePartpath } from '../../scripts/p2p/part_invoke.mjs'
import { isPlainObject } from '../../scripts/p2p/wire_ingress.mjs'
import { getAllUserNames } from '../auth.mjs'
import { loadPart, hasPartMain } from '../parts_loader.mjs'

import { createFountEntityStore } from './entity_store.mjs'

/**
 * @param {string} username
 * @param {string} partpath
 * @param {object} data
 * @param {{ requesterNodeHash?: string | null }} ingress
 * @returns {Promise<import('../../scripts/p2p/part_invoke.mjs').PartInvokeResponse | null>}
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
			throw new Error('P2PInvokeHandler must return { result } or { error }')
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
 * @param {string} [preferredUsername]
 * @param {string} partpath
 * @returns {Promise<string | null>}
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
	const entityStore = createFountEntityStore()

	registerInboundHandler('part_invoke', async (ctx, message) => {
		const partpath = normalizePartpath(message.partpath)
		if (!partpath || !isPlainObject(message.invoke)) return null
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return null
		return invokePartForUser(username, partpath, message.invoke, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
	})

	registerInboundHandler('part_timeline_put', async (ctx, message) => {
		const partpath = normalizePartpath(message.partpath)
		if (!partpath) return null
		const username = await resolveUsernameForPartpath(ctx.replicaUsername, partpath)
		if (!username) return null
		await invokePartForUser(username, partpath, { kind: 'timeline_put', ...message }, {
			requesterNodeHash: ctx.requesterNodeHash ?? message.nodeHash ?? null,
		})
		return null
	})

	void entityStore
}

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'

/**
 * @param {import('npm:express').Request['params']} params 路由 params
 * @returns {string} 小写 entityHash
 */
export function routeEntityHash(params) {
	const hash = String(params.entityHash).toLowerCase()
	if (!isEntityHash128(hash))
		throw httpError(400, 'invalid entityHash')
	return hash
}

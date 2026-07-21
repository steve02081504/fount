/**
 * Social part_query 种类注册表：Load/Unload 各一次批量登记/清空。
 */
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part_query'

/** @type {Map<string, (inboundContext: object, query: unknown) => Promise<object[]> | object[]>} */
let registeredKinds = new Map()

/**
 * 批量注册 Social part_query handlers。
 * @param {Record<string, (inboundContext: object, query: unknown) => Promise<object[]> | object[]>} table kind → handler
 * @returns {void}
 */
export function registerSocialQueryKinds(table) {
	const partpath = getShellPartpath('social')
	registeredKinds = new Map(Object.entries(table))
	for (const [kind, handler] of registeredKinds)
		registerQueryInboundHandler(partpath, kind, handler)
}

/**
 * 清空已注册的 Social part_query handlers。
 * @returns {void}
 */
export function unregisterSocialQueryKinds() {
	const partpath = getShellPartpath('social')
	for (const kind of registeredKinds.keys())
		registerQueryInboundHandler(partpath, kind, () => [])
	registeredKinds = new Map()
}

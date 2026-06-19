/**
 * 按模块写回 tunables JSON。
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { quantize } from './space.mjs'

/** @type {Record<keyof import('./tunables_bundle.mjs').TunablesBundle, URL>} */
const MODULE_URLS = {
	reputation: new URL('../reputation.tunables.json', import.meta.url),
	trustGraph: new URL('../trust_graph.tunables.json', import.meta.url),
	social: new URL('../reputation_social.tunables.json', import.meta.url),
	mailbox: new URL('../mailbox/mailbox.tunables.json', import.meta.url),
	archive: new URL('../../../public/parts/shells/chat/src/chat/archive/archive.tunables.json', import.meta.url),
}

/**
 * @param {unknown} value 任意值
 * @returns {unknown} 递归清理后的值
 */
function sanitizeNumbers(value) {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return value
		if (Number.isInteger(value)) return value
		return quantize(value)
	}
	if (Array.isArray(value)) return value.map(sanitizeNumbers)
	if (value && typeof value === 'object') {
		/** @type {Record<string, unknown>} */
		const out = {}
		for (const [k, v] of Object.entries(value))
			out[k] = sanitizeNumbers(v)
		return out
	}
	return value
}

/**
 * @param {keyof import('./tunables_bundle.mjs').TunablesBundle} module 模块键
 * @param {Record<string, unknown>} data JSON 内容
 * @returns {Promise<string>} 写入路径
 */
export async function writeModuleTunables(module, data) {
	const filePath = fileURLToPath(MODULE_URLS[module])
	const clean = /** @type {Record<string, unknown>} */ sanitizeNumbers(data)
	await writeFile(filePath, `${JSON.stringify(clean, null, '\t')}\n`, 'utf8')
	return filePath
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle 完整 tunables
 * @returns {Promise<string[]>} 各模块 JSON 写入路径
 */
export async function applyTunablesBundle(bundle) {
	const written = []
	written.push(await writeModuleTunables('reputation', bundle.reputation))
	written.push(await writeModuleTunables('trustGraph', bundle.trustGraph))
	written.push(await writeModuleTunables('social', bundle.social))
	written.push(await writeModuleTunables('mailbox', bundle.mailbox))
	written.push(await writeModuleTunables('archive', bundle.archive))
	return written
}

/**
 * @param {string} [dir] sim 目录（默认本模块目录）
 * @returns {string} results 子目录绝对路径
 */
export function resultsDirFromSim(dir = path.dirname(fileURLToPath(import.meta.url))) {
	return path.join(dir, 'results')
}

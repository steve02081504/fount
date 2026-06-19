/**
 * 按模块写回 tunables JSON。
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeBundle, sanitizeBundle } from './space.mjs'

/** @type {Record<keyof import('./tunables_bundle.mjs').TunablesBundle, URL>} */
const MODULE_URLS = {
	reputation: new URL('../reputation.tunables.json', import.meta.url),
	trustGraph: new URL('../trust_graph.tunables.json', import.meta.url),
	social: new URL('../reputation_social.tunables.json', import.meta.url),
	mailbox: new URL('../mailbox/mailbox.tunables.json', import.meta.url),
	archive: new URL('../../../public/parts/shells/chat/src/chat/archive/archive.tunables.json', import.meta.url),
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle 完整 tunables
 * @returns {import('./tunables_bundle.mjs').TunablesBundle} 写盘前规整后的 bundle
 */
export function prepareBundleForApply(bundle) {
	return sanitizeBundle(normalizeBundle(bundle))
}

/**
 * @param {keyof import('./tunables_bundle.mjs').TunablesBundle} module 模块键
 * @param {Record<string, unknown>} data JSON 内容
 * @returns {Promise<string>} 写入路径
 */
export async function writeModuleTunables(module, data) {
	const filePath = fileURLToPath(MODULE_URLS[module])
	await writeFile(filePath, `${JSON.stringify(data, null, '\t')}\n`, 'utf8')
	return filePath
}

/**
 * @param {import('./tunables_bundle.mjs').TunablesBundle} bundle 完整 tunables
 * @returns {Promise<string[]>} 各模块 JSON 写入路径
 */
export async function applyTunablesBundle(bundle) {
	const ready = prepareBundleForApply(bundle)
	const written = []
	written.push(await writeModuleTunables('reputation', ready.reputation))
	written.push(await writeModuleTunables('trustGraph', ready.trustGraph))
	written.push(await writeModuleTunables('social', ready.social))
	written.push(await writeModuleTunables('mailbox', ready.mailbox))
	written.push(await writeModuleTunables('archive', ready.archive))
	return written
}

/**
 * @param {string} [dir] sim 目录（默认本模块目录）
 * @returns {string} results 子目录绝对路径
 */
export function resultsDirFromSim(dir = path.dirname(fileURLToPath(import.meta.url))) {
	return path.join(dir, 'results')
}

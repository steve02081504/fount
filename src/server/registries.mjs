import fs from 'node:fs'
import path from 'node:path'

import { loadJsonFile } from '../scripts/json_loader.mjs'

import { GetPartPath, getPartRegistriesRaw } from './parts_loader.mjs'

/**
 * @typedef {{ id: string, level: number, path: string, partpath?: string }} RegistryEntry
 */

/**
 * 将 partpath 转为前端 URL 前缀（`/parts/shells:chat`）。
 * @param {string} partpath - 部件路径。
 * @returns {string}
 */
export function partpathToUrlPrefix(partpath) {
	const segments = partpath.split('/').filter(Boolean)
	if (!segments.length) return '/parts'
	const [head, ...rest] = segments
	return `/parts/${head}:${rest.join('/')}`
}

/**
 * 将 registry 相对 path 解析为前端 URL。
 * @param {string} partpath - 部件路径。
 * @param {string} relativePath - part 相对路径。
 * @returns {string}
 */
export function resolveRegistryPathToUrl(partpath, relativePath) {
	const normalized = relativePath.replace(/^\/+/, '')
	return `${partpathToUrlPrefix(partpath)}/${normalized}`
}

/**
 * 将 registry 相对 path 解析为文件系统绝对路径。
 * @param {string} username - 用户名。
 * @param {string} partpath - 部件路径。
 * @param {string} relativePath - part 相对路径。
 * @returns {string}
 */
export function resolveRegistryPathToFs(username, partpath, relativePath) {
	return path.join(GetPartPath(username, partpath), relativePath.replace(/^\/+/, ''))
}

/**
 * 对原始条目按 partpath+id 去重（后者覆盖）并按 level 升序排序。
 * 不同 part 可共用相同 id（如各 shell 的 home_registry 条目均为 `function_buttons`）。
 * @param {Array<{ id: string, level: number, path: string, partpath: string }>} rawEntries
 * @returns {Array<{ id: string, level: number, path: string, partpath: string }>}
 */
export function dedupeAndSortRegistryEntries(rawEntries) {
	/** @type {Map<string, { id: string, level: number, path: string, partpath: string }>} */
	const byKey = new Map()
	for (const entry of rawEntries)
		byKey.set(`${entry.partpath}\0${entry.id}`, entry)
	return [...byKey.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
}

/**
 * 获取指定 name 的 registry 条目（已去重排序）。
 * @param {string} username - 用户名。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean, resolve?: 'fs' | 'url' | 'raw' }} [options]
 * @returns {RegistryEntry[]}
 */
export function getRegistry(username, name, { nocache = false, resolve = 'raw' } = {}) {
	const all = getPartRegistriesRaw(username, { nocache })
	const raw = dedupeAndSortRegistryEntries(all[name] ?? [])

	if (resolve === 'raw')
		return raw.map(({ id, level, path: entryPath, partpath }) => ({ id, level, path: entryPath, partpath }))

	if (resolve === 'url')
		return raw.map(({ id, level, path: entryPath, partpath }) => ({
			id,
			level,
			path: resolveRegistryPathToUrl(partpath, entryPath),
		}))

	return raw.map(({ id, level, path: entryPath, partpath }) => ({
		id,
		level,
		path: resolveRegistryPathToFs(username, partpath, entryPath),
		partpath,
	}))
}

/**
 * 列出当前用户聚合到的全部 registry 名称。
 * @param {string} username - 用户名。
 * @param {{ nocache?: boolean }} [options]
 * @returns {string[]}
 */
export function listRegistryNames(username, { nocache = false } = {}) {
	const all = getPartRegistriesRaw(username, { nocache })
	return Object.keys(all).sort()
}

/**
 * 从 registry 条目加载 JSON 数据（按 registry name 取对应字段）。
 * @param {string} username
 * @param {string} registryName
 * @param {{ nocache?: boolean }} [options]
 * @returns {Promise<Array<{ entry: RegistryEntry & { partpath?: string }, data: unknown }>>}
 */
export async function loadRegistryJsonEntries(username, registryName, { nocache = false } = {}) {
	const entries = getRegistry(username, registryName, { nocache, resolve: 'fs' })
	/** @type {Array<{ entry: RegistryEntry & { partpath?: string }, data: unknown }>} */
	const results = []
	for (const entry of entries) 
		try {
			const fsPath = entry.path
			if (entry.partpath && fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()) 
				if (registryName === 'locales') {
					results.push({ entry, data: fsPath })
					continue
				}
			
			const raw = loadJsonFile(fsPath)
			let data = raw
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) 
				if (registryName in raw) data = raw[registryName]
				else if (registryName === 'achievements' && raw.achievements) data = raw.achievements
				else continue
			

			results.push({ entry, data })
		}
		catch { /* skip */ }
	
	return results
}

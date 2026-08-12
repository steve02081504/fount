/**
 * part 路径与 `/parts/<partKey>/…` URL 的纯转换（无 DOM / 无 server 依赖）。
 * Deno 侧经 `src/scripts/part_paths.mjs` 再导出；浏览器经 `/scripts/lib/partPaths.mjs` 引用。
 */

/** part `public/` 目录名（相对 part 根）。 */
export const PART_PUBLIC_DIR = 'public'

/**
 * partpath → URL part key：`shells/chat` → `shells:chat`。
 * @param {string} partpath 部件路径
 * @returns {string} URL 中的 part key
 */
export function partpathToUrlPartKey(partpath) {
	const segments = partpath.split('/').filter(Boolean)
	if (!segments.length) return ''
	const [head, ...rest] = segments
	return rest.length ? `${head}:${rest.join('/')}` : head
}

/**
 * partpath → URL 前缀：`shells/chat` → `/parts/shells:chat`。
 * @param {string} partpath 部件路径
 * @returns {string} 前端 URL 前缀
 */
export function partpathToUrlPrefix(partpath) {
	const key = partpathToUrlPartKey(partpath)
	return key ? `/parts/${key}` : '/parts'
}

/**
 * URL part key → partpath：`shells:chat` → `shells/chat`。
 * @param {string} partKey URL 中的 part key
 * @returns {string} 文件系统部件路径
 */
export function urlPartKeyToPartpath(partKey) {
	return partKey.replace(/:/g, '/')
}

/**
 * 解析 `/parts/<partKey>/filepath` → `{ partpath, filepath }`；无法解析则 null。
 * @param {string} pathname 如 `/parts/shells:chat/hub/x.mjs`
 * @returns {{ partpath: string, filepath: string } | null} 解析结果
 */
export function parsePartsUrlPath(pathname) {
	if (!pathname.startsWith('/parts/')) return null
	const body = pathname.slice('/parts/'.length)
	const slash = body.indexOf('/')
	if (slash < 0) return null
	return {
		partpath: urlPartKeyToPartpath(body.slice(0, slash)),
		filepath: body.slice(slash + 1),
	}
}

/**
 * 相对 parts 根的 FS 路径 → 浏览器 URL path，或 null。
 * 如 `shells/chat/public/hub/x.mjs` → `/parts/shells:chat/hub/x.mjs`。
 * @param {string} relPosix 正斜杠相对路径
 * @returns {string | null} 浏览器 pathname
 */
export function partPublicRelToBrowserPath(relPosix) {
	const match = /^(.+?)\/public\/(.+)$/u.exec(relPosix)
	if (!match) return null
	return `${partpathToUrlPrefix(match[1])}/${match[2]}`
}

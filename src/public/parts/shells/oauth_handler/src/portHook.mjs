import http from 'node:http'

/**
 * 在写死的 localhost 端口上接收 OAuth redirect，再 302 到 fount canonical callback。
 * @param {object} options - 监听选项。
 * @param {number} options.port - 官方 client 登记的端口。
 * @param {string} options.pathname - 官方 client 登记的路径。
 * @param {string} options.targetUrl - canonical callback 完整 URL（不含 query）。
 * @returns {Promise<{ close: () => Promise<void> }>} 关闭句柄。
 */
export function startPortHook({ port, pathname, targetUrl }) {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost')
			if (url.pathname !== pathname) {
				res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
				res.end('Not found')
				return
			}
			res.writeHead(302, { Location: withQuery(targetUrl, url.search) })
			res.end()
		})
		server.on('error', reject)
		server.listen(port, 'localhost', () => {
			resolve({
				/**
				 * 关闭 hook 端口。
				 * @returns {Promise<void>} 关闭完成。
				 */
				close: () => new Promise(closeResolve => {
					server.close(() => closeResolve())
				}),
			})
		})
	})
}

/**
 * 把 query 接到目标 URL 上（后写覆盖同名键）。
 * @param {string} targetUrl - 目标。
 * @param {string} search - `?a=1` 或 `a=1`。
 * @returns {string} 带 query 的 URL。
 */
export function withQuery(targetUrl, search) {
	const destination = new URL(targetUrl)
	for (const [key, value] of new URLSearchParams(search.startsWith('?') ? search.slice(1) : search))
		destination.searchParams.set(key, value)
	return destination.href
}

/**
 * 拼接 canonical OAuth callback 页 URL。
 * @param {string} hosturl - fount 对外 origin。
 * @returns {string} callback 页 URL。
 */
export function canonicalCallbackUrl(hosturl) {
	return new URL('/parts/shells:oauth_handler/callback', hosturl).href
}

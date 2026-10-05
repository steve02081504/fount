import { render } from 'npm:cloudflare-error-page'

/**
 * 把匿名远程请求的 404 伪装成 Cloudflare 500，避免暴露 fount 的路由结构。
 * 已认证的请求即使装了拦截也照常返回。
 * @param {import('npm:express').Response} res - 要保护的响应对象。
 * @returns {void}
 */
export function maskNotFound(res) {
	const { req } = res
	const originalEnd = res.end
	const originalWrite = res.write
	const originalWriteHead = res.writeHead
	let masked = false
	/**
	 * @param {any[]} args - end/write 的原始参数。
	 * @returns {() => void} 其中的回调（没有则空函数）。
	 */
	const callbackOf = args => args.find(arg => typeof arg === 'function') || (() => {})
	/**
	 * 在响应头提交前把 404 替换成诱饵页。
	 * @param {() => void} acknowledge - 调用方 end/write 带的回调。
	 * @returns {boolean} 是否已替换响应。
	 */
	function replace(acknowledge) {
		// 改写本身会再走一次 writeHead/end，放行那一次，否则自锁。
		if (masked || req.user || res.statusCode !== 404 || res.headersSent) return false
		masked = true
		const html = render({
			title: 'Internal server error',
			error_code: '500',
			more_information: { hidden: false, text: 'cloudflare.com', link: '', for: 'more information' },
			browser_status: { status: 'ok', location: 'You', name: 'Browser', status_text: 'Working' },
			cloudflare_status: { status: 'error', location: '', name: 'Cloudflare', status_text: 'Error' },
			host_status: { status: 'ok', location: 'Website', name: 'Host', status_text: 'Working' },
			error_source: 'cloudflare',
			what_happened: 'There is an internal server error on Cloudflare\'s network.',
			what_can_i_do: 'Please try again in a few minutes.',
			perf_sec_by: { text: '', link: '' },
			ray_id: (req.get('Cf-Ray') ?? '').substring(0, 16),
			client_ip: req.get('X-Forwarded-For') || req.socket.remoteAddress,
		})
		// 先落地状态与头部，再调原生 end：它内部还会走一次 writeHead，那一次必须看到 500。
		for (const header of ['Content-Length', 'Content-Encoding', 'ETag', 'Content-Range']) res.removeHeader(header)
		res.status(500).type('html')
		originalEnd.call(res, req.method === 'HEAD' ? undefined : html)
		acknowledge()
		return true
	}
	/**
	 * @param {number} [statusCode] 原始状态码；Deno 的 `_implicitHeader` 会不传。
	 * @param {...any} args 原始头部参数。
	 * @returns {import('npm:express').Response} 响应对象。
	 */
	res.writeHead = function (statusCode, ...args) {
		// Deno 的 `_implicitHeader` 不传状态码，此时必须沿用 `res.statusCode`，
		// 否则原生 writeHead 会收到 0 并抛 ERR_INVALID_ARG_TYPE。
		const status = Number.isInteger(statusCode) ? statusCode : res.statusCode
		if (replace(() => {})) return this
		res.statusCode = status
		return originalWriteHead.apply(this, [status, ...args])
	}
	/**
	 * @param {...any} args 原始 end 参数。
	 * @returns {import('npm:express').Response} 响应对象。
	 */
	res.end = function (...args) {
		if (replace(callbackOf(args))) return this
		// 已被改写：调用方后续的 end/write 不能再落到已收尾的响应上。
		if (masked) return this
		return originalEnd.apply(this, args)
	}
	/**
	 * @param {...any} args 原始 write 参数。
	 * @returns {boolean} 是否允许继续写入。
	 */
	res.write = function (...args) {
		if (replace(callbackOf(args))) return true
		if (masked) return true
		return originalWrite.apply(this, args)
	}
}

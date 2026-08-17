import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { __dirname } from '../base.mjs'

import { betterSendFile } from './resources.mjs'

const DECOY_ROOT = path.join(__dirname, 'src/public/pages')

/**
 * 将 .php URL 路径规范为 decoy 目录下的相对路径。
 * @param {string} reqPath Express `req.path`
 * @returns {string | null} 如 `server-status.php`，无法映射时 null
 */
function phpDecoyRelPath(reqPath) {
	if (!reqPath.endsWith('.php')) return null
	const safe = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '')
	if (!safe.endsWith('.php') || safe.includes('\0')) return null
	return safe
}

/**
 * 注册 PHP 诱饵路由：将 `*.php` 请求映射到同名的 `.php.html` 或 `.php.mjs`。
 * @param {import('../../scripts/WsAbleRouter.mjs').WsAbleRouter} router Express 路由器（须在 cookieParser 之后注册）。
 * @returns {void}
 */
export function registerPhpDecoy(router) {
	router.use(async (req, res, next) => {
		const rel = phpDecoyRelPath(req.path)
		if (!rel) return next()

		if (!req.cookies?.PHPSESSID) {
			const fakeSessionId = crypto.randomBytes(16).toString('hex')
			// 不加 HttpOnly，还原 2002 年 PHP 4 的真实 Cookie 行为
			res.setHeader('Set-Cookie', `PHPSESSID=${fakeSessionId}; path=/`)
		}

		const targetTxt = path.join(DECOY_ROOT, `${rel}.txt`)
		if (fs.existsSync(targetTxt))
			return betterSendFile(res.status(200), targetTxt)

		const targetHtml = path.join(DECOY_ROOT, `${rel}.html`)
		if (fs.existsSync(targetHtml))
			return betterSendFile(res.status(200), targetHtml)

		const targetMjs = path.join(DECOY_ROOT, `${rel}.mjs`)
		if (fs.existsSync(targetMjs)) {
			const result = await import(pathToFileURL(targetMjs).href)
			if (result.handle) return result.handle(req, res)
			if (result.generateHtml) return res.status(200).send(await result.generateHtml(req))
		}
		next()
	})
}

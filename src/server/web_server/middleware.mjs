import cookieParser from 'npm:cookie-parser'
import cors from 'npm:cors'
import express from 'npm:express'
import fileUpload from 'npm:express-fileupload'

import { console } from '../../scripts/i18n.mjs'
import { auth_request } from '../auth.mjs'
import { info } from '../info.mjs'
import { webRequestHappend } from '../server.mjs'

/**
 * 一个中间件，根据请求是否经过身份验证来应用不同的中间件。
 * @param {Function} if_auth - 如果请求经过身份验证，则应用的中间件。
 * @param {Function} if_not_auth - 如果请求未经过身份验证，则应用的中间件。
 * @returns {Function} 中间件函数。
 */
export function diff_if_auth(if_auth, if_not_auth) {
	return async (req, res, next) => {
		if (await auth_request(req, res)) return if_auth(req, res, next)
		return if_not_auth(req, res, next)
	}
}

/**
 * 为应用程序注册所有中间件。
 * @param {import('../../scripts/WsAbleRouter.mjs').WsAbleRouter} router - 要在其上注册中间件的 Express 路由器。
 * @returns {void}
 */
export function registerMiddleware(router) {
	router.use((req, res, next) => {
		res.setHeader('X-Powered-By', info.xPoweredBy)
		if (!(req.path.endsWith('/heartbeat') || req.path.endsWith('/api/sentrytunnel')))
			console.logI18n('fountConsole.web.requestReceived', {
				method: req.method + ' '.repeat(Math.max(0, 8 - req.method.length)),
				url: req.url.replace(/fount-apikey=[^&]*/, 'fount-apikey=45450721')
			})
		webRequestHappend()
		return next()
	})

	router.use(diff_if_auth(
		express.json({ limit: Infinity }),
		express.json({ limit: 5 * 1024 * 1024 })
	))

	router.use(diff_if_auth(
		cors(),
		(req, res, next) => next()
	))

	router.use(diff_if_auth(
		express.urlencoded({ limit: Infinity, extended: true }),
		express.urlencoded({ limit: 5 * 1024 * 1024, extended: true })
	))

	router.use(diff_if_auth(
		fileUpload({ limits: { fileSize: Infinity } }),
		fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } })
	))

	router.use(cookieParser())
}

import cookieParser from 'npm:cookie-parser'
import cors from 'npm:cors'
import express from 'npm:express'
import fileUpload from 'npm:express-fileupload'

import { console } from '../../scripts/i18n.mjs'
import { auth_request } from '../auth.mjs'

export function diff_if_auth(if_auth, if_not_auth) {
	return async (req, res, next) => {
		if (await auth_request(req)) return if_auth(req, res, next)
		return if_not_auth(req, res, next)
	}
}

/**
 * @param {import('../../scripts/WsAbleRouter.mjs').WsAbleRouter} router
 */
export function registerMiddleware(router) {
	router.use((req, res, next) => {
		if (new Date().getMonth() === 3 && new Date().getDate() === 1)
			res.setHeader('X-Powered-By', 'Skynet/0.2')
		else res.setHeader('X-Powered-By', 'PHP/4.2.0')
		if (!(req.path.endsWith('/heartbeat') || req.path.endsWith('/api/sentrytunnel')))
			console.logI18n('fountConsole.web.requestReceived', {
				method: req.method + ' '.repeat(Math.max(0, 8 - req.method.length)),
				url: req.url
			})
		return next()
	})

	router.use(diff_if_auth(
		express.json({ limit: Infinity }),
		express.json({ limit: 5 * 1024 * 1024 })
	))

	router.use(diff_if_auth(
		cors(),
		(_req, _res, next) => next()
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

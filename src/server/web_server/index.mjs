import * as Sentry from 'npm:@sentry/deno'
import cookieParser from 'npm:cookie-parser'
import cors from 'npm:cors'
import express from 'npm:express'
import fileUpload from 'npm:express-fileupload'

import { console } from '../../scripts/i18n.mjs'
import { sentrytunnel } from '../../scripts/sentrytunnel.mjs'
import { auth_request } from '../auth.mjs'
import { __dirname } from '../base.mjs'

import { PartsRouter } from './parts_router.mjs'

export const app = express()
app.set('trust proxy', 'loopback')
const mainRouter = express.Router()
const FinalRouter = express.Router()

app.use(mainRouter)
app.use(PartsRouter)
app.use(FinalRouter)

mainRouter.use(async (req, res, next) => {
	if (!(req.path.endsWith('/heartbeat') || req.path.endsWith('/api/sentrytunnel')))
		console.logI18n('fountConsole.web.requestReceived', {
			method: req.method + ' '.repeat(Math.max(0, 8 - req.method.length)),
			url: req.url
		})
	return next()
})
function diff_if_auth(if_auth, if_not_auth) {
	return async (req, res, next) => {
		if (await auth_request(req)) return if_auth(req, res, next)
		return if_not_auth(req, res, next)
	}
}
mainRouter.post('/api/sentrytunnel', diff_if_auth(
	express.raw({ type: '*/*', limit: Infinity }),
	express.raw({ type: '*/*', limit: 5 * 1024 * 1024 })
), sentrytunnel)
mainRouter.use(diff_if_auth(
	express.json({ limit: Infinity }),
	express.json({ limit: 5 * 1024 * 1024 })
))
mainRouter.use(diff_if_auth(
	cors(),
	(_req, _res, next) => next()
))
mainRouter.use(diff_if_auth(
	express.urlencoded({ limit: Infinity, extended: true }),
	express.urlencoded({ limit: 5 * 1024 * 1024, extended: true })
))
mainRouter.use(diff_if_auth(
	fileUpload({ limits: { fileSize: Infinity } }),
	fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } })
))
mainRouter.use(cookieParser())

FinalRouter.use((req, res) => {
	if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return res.status(404).json({ message: 'API Not found' })
	if (req.accepts('html')) return res.status(404).sendFile(__dirname + '/src/pages/404/index.html')
	res.status(404).type('txt').send('Not found')
})
const errorHandler = (err, req, res, next) => {
	if (!err.skip_report) Sentry.captureException(err)
	console.error(err)
	res.status(500).json({ message: 'Internal Server Error', errors: err.errors, error: err.message })
}
PartsRouter.use(errorHandler)
FinalRouter.use(errorHandler)
app.use(errorHandler)

const { registerEndpoints } = await import('./endpoints.mjs')
registerEndpoints(mainRouter)
mainRouter.use((req, res, next) => {
	if (req.method != 'GET') return next()
	switch (req.path) {
		case '/apple-touch-icon-precomposed.png':
		case '/apple-touch-icon.png':
			return res.sendFile(__dirname + '/src/pages/favicon.png')
		case '/favicon.svg':
			return res.sendFile(__dirname + '/imgs/icon.svg')
	}
	return next()
})
mainRouter.use(express.static(__dirname + '/src/pages'))

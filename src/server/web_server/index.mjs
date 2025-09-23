import * as Sentry from 'npm:@sentry/deno'
import express from 'npm:express'

import { sentrytunnel } from '../../scripts/sentrytunnel.mjs'
import { WsAbleApp, WsAbleRouter } from '../../scripts/WsAbleRouter.mjs'
import { __dirname } from '../base.mjs'

import { registerEndpoints } from './endpoints.mjs'
import { diff_if_auth, registerMiddleware } from './middleware.mjs'
import { PartsRouter } from './parts_router.mjs'
import { registerResources } from './resources.mjs'
import { registerWellKnowns } from './well-knowns.mjs'

export const app = WsAbleApp()
app.disable('x-powered-by')
const mainRouter = WsAbleRouter()
const FinalRouter = express.Router()

// Define the order of routers
app.use(mainRouter)
app.use(PartsRouter)
app.use(FinalRouter)

// Add the sentrytunnel endpoint for bug reports
mainRouter.post('/api/sentrytunnel', diff_if_auth(
	express.raw({ type: '*/*', limit: Infinity }),
	express.raw({ type: '*/*', limit: 5 * 1024 * 1024 })
), sentrytunnel)

// Setup middleware on the main router
registerMiddleware(mainRouter)

// Setup API, well-known, and resource endpoints on the main router
registerEndpoints(mainRouter)
registerWellKnowns(mainRouter)
registerResources(mainRouter)

// Setup final handlers (404, errors)
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

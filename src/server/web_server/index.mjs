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

/**
 * 主 Express 应用程序实例。
 * @type {import('express').Application}
 */
export const app = WsAbleApp()
app.disable('x-powered-by')
const mainRouter = WsAbleRouter()
const FinalRouter = express.Router()

// 定义路由器的顺序
app.use(mainRouter)
app.use(PartsRouter)
app.use(FinalRouter)

// 为错误报告添加 sentrytunnel 端点
mainRouter.post('/api/sentrytunnel', diff_if_auth(
	express.raw({ type: '*/*', limit: Infinity }),
	express.raw({ type: '*/*', limit: 5 * 1024 * 1024 })
), sentrytunnel)

// 在主路由器上设置中间件
registerMiddleware(mainRouter)

// 在主路由器上设置 API、well-known 和资源端点
registerEndpoints(mainRouter)
registerWellKnowns(mainRouter)
registerResources(mainRouter)

// 设置最终处理程序（404、错误）
FinalRouter.use((req, res) => {
	if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return res.status(404).json({ message: 'API Not found' })
	if (req.accepts('html')) return res.status(404).sendFile(__dirname + '/src/pages/404/index.html')
	res.status(404).type('txt').send('Not found')
})
/**
 * 应用程序的主错误处理程序。
 * @param {Error} err - 错误对象。
 * @param {import('express').Request} req - Express 请求对象。
 * @param {import('express').Response} res - Express 响应对象。
 * @param {import('express').NextFunction} next - 下一个中间件函数。
 * @returns {void}
 */
const errorHandler = (err, req, res, next) => {
	if (!err.skip_report) Sentry.captureException(err)
	console.error(err)
	res.status(500).json({ message: 'Internal Server Error', errors: err.errors, error: err.message })
}

PartsRouter.use(errorHandler)
FinalRouter.use(errorHandler)
app.use(errorHandler)

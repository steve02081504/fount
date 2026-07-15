/**
 * 【文件】group/routes/channels.mjs
 * 【职责】频道 HTTP 路由聚合入口。
 * 【关联】被 group/endpoints.mjs 注册；子模块按资源拆分。
 */
import { registerChannelCallRoutes } from './channelCall.mjs'
import { registerChannelCrudRoutes } from './channelCrud.mjs'
import { registerChannelMessageRoutes } from './channelMessages.mjs'
import { registerChannelReactionRoutes } from './channelReactions.mjs'
import { registerChannelStreamingRoutes } from './channelStreaming.mjs'
import { registerChannelVoteRoutes } from './channelVotes.mjs'

/**
 * 注册频道相关 HTTP 路由。
 * @param {import('npm:websocket-express').Router} router Express 路由
 * @param {import('npm:express').RequestHandler} authenticate 鉴权中间件
 * @returns {void}
 */
export function registerChannelRoutes(router, authenticate) {
	registerChannelReactionRoutes(router, authenticate)
	registerChannelStreamingRoutes(router, authenticate)
	registerChannelCallRoutes(router, authenticate)
	registerChannelMessageRoutes(router, authenticate)
	registerChannelCrudRoutes(router, authenticate)
	registerChannelVoteRoutes(router, authenticate)
}

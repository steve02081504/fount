import { authenticate } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { config } from '../server.mjs'

/**
 * 为应用程序注册 .well-known 路由。
 * @param {import('express').Router} router - 要在其上注册路由的 Express 路由器。
 * @returns {void}
 */
export function registerWellKnowns(router) {
	router.get('/.well-known/appspecific/com.chrome.devtools.json', authenticate, (_req, res) => {
		res.json({
			workspace: {
				root: __dirname,
				uuid: config.uuid,
			}
		})
	})
	router.get('/.well-known/change-password', (_req, res) => {
		res.redirect('/shells/UserSettings')
	})
}

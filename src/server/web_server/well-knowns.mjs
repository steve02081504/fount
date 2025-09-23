import { authenticate } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { config } from '../server.mjs'


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

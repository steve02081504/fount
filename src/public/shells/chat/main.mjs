import { setEndpoints, unsetEndpoints } from "./src/server/endpoints.mjs"

export default {
	name: 'chat',
	avatar: '',
	description: 'default description',
	description_markdown: 'default description',
	Load: (app) => {
		setEndpoints(app)
	},
	Unload: (app) => {
		unsetEndpoints(app)
	}
}

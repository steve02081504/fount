import { setEndpoints, unsetEndpoints } from "./src/endpoints.mjs"

export default {
	name: 'chat',
	avatar: '',
	description: 'default description',
	description_markdown: 'default description',
	Load: (app) => {
		setEndpoints(app)
		return { success: true }
	},
	Unload: (app) => {
		unsetEndpoints(app)
	}
}

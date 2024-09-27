import { setEndpoints, unsetEndpoints } from "./src/endpoints.mjs"
import { app } from "../../../server/server.mjs"

setEndpoints(app)

export default {
	name: 'chat',
	avatar: '',
	description: 'default description',
	description_markdown: 'default description',
}

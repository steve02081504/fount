import { loadPart } from "../../../server/managers/index.mjs";

export default {
	info: {
		'': {
			name: 'preload',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: (app) => { },
	Unload: (app) => { },
	ArgumentsHandler: async (user, args) => {
		loadPart(user, args[0], args[1])
	},
	IPCInvokeHandler: async (user, data) => {
		loadPart(user, data.parttype, data.partname)
	}
}

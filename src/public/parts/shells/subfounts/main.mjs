import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * Subfounts Shell - Peer-to-peer subfount management
 */
export default {
	info,
	/**
	 * Loads the subfounts shell and sets up API endpoints.
	 * @param {object} root0 - Parameter object.
	 * @param {object} root0.router - Express router instance.
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}

import { hosturl_in_local_ip } from '../../../../server/server.mjs'
import qrcode from 'npm:qrcode-terminal'

export default {
	info: {
		'': {
			name: 'access',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: async ({ router }) => { },
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const url = await hosturl_in_local_ip()
				console.log(`Access fount on other devices in the same network via: ${url}`)
				qrcode.generate(url, { small: true })
			},
			IPCInvokeHandler: async (user, args) => {
				return hosturl_in_local_ip()
			}
		}
	}
}
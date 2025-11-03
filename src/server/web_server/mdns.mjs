import { geti18n, console } from '../../scripts/i18n.mjs'

/**
 * mDNS 服务实例。
 * @type {import('npm:@homebridge/ciao').AdvertisedService}
 */
export let mdns

/**
 * 初始化并广播 mDNS 服务。
 * @param {number} port - 服务的端口号。
 * @param {('http'|'https')} protocol - 服务的协议。
 */
export async function initMdns(port, protocol) {
	const ciao = await import('npm:@homebridge/ciao')
	const responder = ciao.getResponder()
	const mdns_config = {
		name: 'fount',
		port,
		type: protocol,
		txt: {
			description: geti18n('fountConsole.server.mdns.description'),
		},
	}
	mdns = responder.createService(mdns_config)
	mdns.advertise().catch(error => {
		console.errorI18n('fountConsole.server.mdns.failed', { error })
	})
}

import { geti18n, console } from '../../scripts/i18n.mjs'

/**
 * mDNS 服务实例。
 * @type {import('npm:@homebridge/ciao').AdvertisedService | import('npm:bonjour-service').Service}
 */
export let mdns

/**
 * 初始化并广播 mDNS 服务。
 * @param {number} port - 服务的端口号。
 * @param {('http'|'https')} protocol - 服务的协议。
 * @param {object} config - 其他 mDNS 配置选项。
 * @returns {void} 什么都没有。
 */
export async function initMdns(port, protocol, config) {
	const mdns_config = {
		name: 'fount',
		port,
		type: protocol,
		txt: {
			description: geti18n('fountConsole.server.mdns.description'),
		},
		...config,
	}
	/* // https://github.com/denoland/deno/issues/30486
	const ciao = await import('npm:@homebridge/ciao')
	const responder = ciao.getResponder()
	mdns = responder.createService(mdns_config)
	mdns.advertise().catch(async error => { // 不应await此操作，会阻塞服务器
		console.errorI18n('fountConsole.server.mdns.failed', { error })
		mdns.stop()
	*/
	const { Bonjour } = await import('npm:bonjour-service')
	const instance = new Bonjour({}, error => {
		console.errorI18n('fountConsole.server.mdns.bonjourFailed', { error })
	})
	mdns = instance.publish(mdns_config)
	// })
}

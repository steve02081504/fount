import { setInterval, clearInterval } from 'node:timers'

import { Client } from 'npm:@xhayper/discord-rpc'

import { startTime } from '../server/base.mjs'
import { info } from '../server/info.mjs'
import { config } from '../server/server.mjs'

import { in_docker, in_termux } from './env.mjs'
import { ms } from './ms.mjs'

let activity = {
}
/**
 * 设置 Discord RPC 活动。
 */
async function setActivity() {
	if (!client) return
	for (const key in activity) if (activity[key] === undefined) delete activity[key]
	await client.user?.setActivity({
		startTimestamp: config.reboot?.sessionStartTime || startTime.getTime(),
		...activity || defaultActivity()
	})
}

let interval = null
let loginInterval = null
let client = null

/**
 * 获取默认活动。
 * @returns {object} - 默认活动。
 */
function defaultActivity() {
	return {
		details: info.activity,
		state: info.logotext,
		stateUrl: info.shortlinkUrl,
		largeImageKey: 'icon',
		largeImageText: info.shortlinkUrl.split('://')[1],
		smallImageKey: undefined,
		smallImageText: undefined,
		buttons: [
			{
				label: info.shortlinkName,
				url: info.shortlinkUrl,
			},
		],
		instance: false,
	}
}

/**
 * 启动 Discord RPC 客户端。
 * @param {string} [clientId='1344722070323335259'] - Discord 客户端 ID。
 * @param {object} [activity] - 要设置的初始活动。
 * @returns {void}
 */
export function StartRPC(clientId = '1344722070323335259', activity) {
	if (in_docker || in_termux) return

	if (loginInterval) clearInterval(loginInterval)
	if (interval) clearInterval(interval)
	StopRPC()
	client = new Client({ clientId })

	SetActivity(activity)

	client.on('ready', async () => {
		await setActivity()

		// activity can only be set every 15 seconds
		interval = setInterval(() => { setActivity() }, ms('15s')).unref()
	})

	loginInterval = setInterval(async () => {
		try {
			await client.login()
			clearInterval(loginInterval)
		}
		catch (error) {
			if (error.name == 'COULD_NOT_CONNECT') return
			console.error(error)
		}
	}, ms('15s')).unref()
}

/**
 * 设置 Discord RPC 活动。
 * @param {object} newActivity - 要设置的活动。
 * @returns {void}
 */
export function SetActivity(newActivity) {
	activity = newActivity
}

/**
 * 停止 Discord RPC 客户端。
 * @returns {void}
 */
export function StopRPC() {
	if (!client) return
	client.destroy()
	client = undefined
}

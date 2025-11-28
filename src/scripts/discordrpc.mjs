import process from 'node:process'

import { Client } from 'npm:@xhayper/discord-rpc'

import { in_docker, in_termux } from './env.mjs'

const FountStartTimestamp = new Date()
let _activity = {
}
/**
 * 设置 Discord RPC 活动。
 */
async function _setActivity() {
	if (!client) return
	for (const key in _activity) if (_activity[key] === undefined) delete _activity[key]
	await client.user?.setActivity({
		startTimestamp: FountStartTimestamp,
		..._activity
	})
}

let interval = null
let client = null

/**
 * 启动 Discord RPC 客户端。
 * @param {string} [clientId='1344722070323335259'] - Discord 客户端 ID。
 * @param {object} [activity] - 要设置的初始活动。
 * @returns {void}
 */
export function StartRPC(
	clientId = '1344722070323335259',
	activity = {
		details: 'fountting',
		state: Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!',
		startTimestamp: undefined,
		largeImageKey: 'icon',
		largeImageText: 'github.com/steve02081504/fount',
		smallImageKey: undefined,
		smallImageText: undefined,
		instance: false,
	}
) {
	if (process.platform === 'win32') return // https://github.com/denoland/deno/issues/28332

	if (in_docker || in_termux) return

	if (interval) clearInterval(interval)
	StopRPC()
	client = new Client({ clientId })

	SetActivity(activity)

	client.on('ready', async () => {
		await _setActivity()

		// activity can only be set every 15 seconds
		interval = setInterval(() => { _setActivity() }, 15e3)
	})

	client.login().catch(console.error)
}

/**
 * 设置 Discord RPC 活动。
 * @param {object} activity - 要设置的活动。
 * @returns {void}
 */
export function SetActivity(activity) {
	_activity = activity
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

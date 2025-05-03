import DiscordRPC from 'npm:fixed-discord-rpc'
import { in_docker, in_termux } from './env.mjs'
import process from 'node:process'

let rpc

const FountStartTimestamp = new Date()
let _activity = {

}
function _setActivity() {
	if (!rpc) return
	for (const key in _activity) if (_activity[key] === undefined) delete _activity[key]
	rpc.setActivity({
		startTimestamp: FountStartTimestamp,
		..._activity
	})
}

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

	StopRPC()
	rpc ??= new DiscordRPC.Client({ transport: 'ipc' })

	SetActivity(activity)

	rpc.on('ready', () => {
		_setActivity()

		// activity can only be set every 15 seconds
		setInterval(() => { _setActivity() }, 15e3)
	})

	rpc.login({ clientId }).catch(console.error)
}

export function SetActivity(activity) {
	_activity = activity
}

export function StopRPC() {
	if (!rpc) return
	rpc.destroy()
}

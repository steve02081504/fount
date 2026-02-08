import { setInterval } from 'node:timers'

import { ms } from '../scripts/ms.mjs'

/**
 * 获取软件信息对象
 * @returns {{
 * 	title: string
 * 	activity: string
 * 	logotext: string
 * 	logotextColor: `#${string}`
 * 	shortlinkName: string
 * 	shortlinkUrl: `${string}://${string}`
 * 	xPoweredBy: `${string}/${string}`
 * }} 软件信息对象
 */
function getInfo() {
	const result = {
		title: 'fount',
		activity: 'fountting',
		logotext: Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!',
		logotextColor: '#0e3c5c',
		shortlinkName: 'GitHub',
		shortlinkUrl: 'https://bit.ly/get-fount',
		xPoweredBy: 'PHP/4.2.0',
	}
	if (new Date().getDate() === 1 && new Date().getMonth() === 0) return {
		...result,
		logotext: 'Happy New Year!',
		logotextColor: '#ff0000',
	}
	if (new Date().getDate() === 1 && new Date().getMonth() === 3) return {
		...result,
		title: 'SillyTavern',
		activity: 'SillyTaverning',
		logotext: Array(Math.floor(Math.random() * 7)).fill('Si-').join('') + 'SillyTavern!',
		logotextColor: '#7c1d1d',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'Skynet/0.2',
	}
	if (new Date().getDate() === 31 && new Date().getMonth() === 10) return {
		...result,
		logotext: 'fount or fount?',
	}
	return result
}
/**
 * 软件信息对象
 */
export let info = getInfo()
setInterval(() => {
	info = getInfo()
}, ms('1h')).unref()

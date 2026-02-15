import fs from 'node:fs'
import { setInterval } from 'node:timers'

import seedrandom from 'npm:seedrandom'

import { ms } from '../scripts/ms.mjs'


const defaultInfo = {
	title: 'fount',
	activity: 'fountting',
	logotext: Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!',
	logotextColor: '#0e3c5c',
	shortlinkName: 'GitHub',
	shortlinkUrl: 'https://bit.ly/get-fount',
	xPoweredBy: 'PHP/4.2.0',
}
const steveInfo = {
	...defaultInfo,
	title: 'Steve',
	activity: 'Steveing',
	logotext: Array(Math.floor(Math.random() * 7)).fill('St-').join('') + 'Steve!',
	logotextColor: '#ab3fab',
	shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
	xPoweredBy: 'steve/0.2.0.8.1.5.0.4',
}
const trollInfos = [
	steveInfo,
	{
		...defaultInfo,
		title: 'SillyTavern',
		activity: 'SillyTaverning',
		logotext: Array(Math.floor(Math.random() * 7)).fill('Si-').join('') + 'SillyTavern!',
		logotextColor: '#7c1d1d',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'Skynet/0.2',
	},
	{
		...defaultInfo,
		title: 'Terraria',
		activity: 'Terraring',
		logotext: Array(Math.floor(Math.random() * 7)).fill('Te-').join('') + 'Terraria!',
		logotextColor: '#25d46c',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'Terraria/1.4.5.0',
	}
]
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
	if (new Date().getDate() === 1 && new Date().getMonth() === 0) return {
		...defaultInfo,
		logotext: 'Happy New Year!',
		logotextColor: '#ff0000',
	}
	if (new Date().getDate() === 1 && new Date().getMonth() === 3) {
		const random = seedrandom(new Date().toISOString().slice(0, 10))()
		return trollInfos[Math.floor(random * trollInfos.length)]
	}
	if (new Date().getDate() === 31 && new Date().getMonth() === 10) return {
		...defaultInfo,
		logotext: 'fount or fount?',
	}
	if (fs.existsSync('im.steve')) return steveInfo
	return defaultInfo
}
/**
 * 软件信息对象
 */
export let info = getInfo()
setInterval(() => {
	info = getInfo()
}, ms('1h')).unref()

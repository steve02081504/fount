import fs from 'node:fs'
import { setInterval } from 'node:timers'

import seedrandom from 'npm:seedrandom'

import { ms } from '../scripts/ms.mjs'

/**
 * 像假面骑士decade的音效一样在字符串前面添加一些磕绊感
 * @param {string} str 要添加磕绊感的字符串
 * @param {number} [repeat_count=Math.floor(Math.random() * 7)] 开始部分的重复次数，默认随机生成0-7次
 * @returns {string} 添加磕绊感后的字符串
 */
function decadeString(str, repeat_count = Math.floor(Math.random() * 7)) {
	return Array(repeat_count).fill(str.slice(0, 2) + '-').join('') + str
}

/**
 * 软件信息对象
 * @type {Record<string, {
 * 	title: string
 * 	activity: string
 * 	logotext: string
 * 	logotextColor: `#${string}`
 * 	shortlinkUrl: `${string}://${string}`
 * 	xPoweredBy: `${string}/${string}`
 * }}
 * @readonly
 */
const infos = {
	fount: {
		title: 'fount',
		activity: 'fountting',
		logotext: decadeString('fount!'),
		logotextColor: '#0e3c5c',
		shortlinkName: 'GitHub',
		shortlinkUrl: 'https://tinyurl.com/get-fount',
		xPoweredBy: 'PHP/4.2.0',
	},
	steve: {
		title: 'Steve',
		activity: 'Steveing',
		logotext: decadeString('Steve!'),
		logotextColor: '#ab3fab',
		shortlinkName: 'GitHub',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'steve/0.2.0.8.1.5.0.4',
	},
	terraria: {
		title: 'Terraria',
		activity: 'Terraring',
		logotext: decadeString('Terraria!'),
		logotextColor: '#25d46c',
		shortlinkName: 'GitHub',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'Terraria/1.4.5.0',
	},
	sillytavern: {
		title: 'SillyTavern',
		activity: 'SillyTaverning',
		logotext: decadeString('SillyTavern!'),
		logotextColor: '#7c1d1d',
		shortlinkName: 'GitHub',
		shortlinkUrl: 'https://youtu.be/dQw4w9WgXcQ',
		xPoweredBy: 'Skynet/0.2',
	},
}
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
		...infos.fount,
		logotext: 'Happy New Year!',
		logotextColor: '#ff0000',
	}
	if (new Date().getDate() === 1 && new Date().getMonth() === 3) {
		const random = seedrandom(new Date().toISOString().slice(0, 10))()
		let randkey
		do randkey = Object.keys(infos)[Math.floor(random * Object.keys(infos).length)]
		while (randkey === 'fount')
		return infos[randkey]
	}
	if (new Date().getDate() === 31 && new Date().getMonth() === 10) return {
		...infos.fount,
		logotext: 'fount or fount?',
	}
	if (fs.existsSync('im.steve')) return infos.steve
	return infos.fount
}
/**
 * 软件信息对象
 */
export let info = getInfo()
setInterval(() => {
	info = getInfo()
}, ms('1h')).unref()

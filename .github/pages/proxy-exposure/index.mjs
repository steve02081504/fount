/**
 * 公网代理配置错误提示页：fount 停用 Web 服务后访客被送到这里。
 * 文字讲清风险与恢复步骤；背景是会呼吸的血肉、追着指针的眼睛与触手，声音在首个手势后实时合成。
 */
import { getAvailableLocales, getLocaleNames, geti18n, initTranslations, onLanguageChange, primaryLocale, setElementI18n, setLanguage } from '../scripts/i18n/index.mjs'
import { whenAudioAllowed } from '../scripts/lib/proceduralAudio.mjs'
import { createShaderCanvas } from '../scripts/lib/shaderCanvas.mjs'

import { createDread } from './dread.mjs'
import { FLESH_FRAGMENT, createEyes } from './flesh.mjs'
import { createTendrils } from './tendrils.mjs'

/** 腐化从 0 涨满所需的停留时长（秒）。 */
const CORRUPTION_SECONDS = 80
/** 按住多久算“看清”（毫秒）。 */
const LUCID_HOLD = 350
/** 两次“触碰”之间的冷却（秒）。 */
const TOUCH_COOLDOWN = 9
const MUTED_KEY = 'fount.proxyExposure.muted'

await initTranslations('proxy_exposure')

const body = document.body
const language = document.getElementById('language')
const names = getLocaleNames()
for (const locale of getAvailableLocales()) {
	const option = document.createElement('option')
	option.value = locale
	option.textContent = names.get(locale) || locale
	language.appendChild(option)
}
language.value = primaryLocale()
language.addEventListener('change', async () => {
	language.disabled = true
	try { await setLanguage([language.value]) }
	finally { language.disabled = false }
})

const omen = document.getElementById('omen')
const watching = document.getElementById('watching')
const touched = document.getElementById('touched')
const wayOut = document.getElementById('way-out')
const main = document.querySelector('main')
onLanguageChange(() => { omen.dataset.echo = geti18n('proxy_exposure.omen') })

const pointer = { x: innerWidth * 0.5, y: innerHeight * 0.4, present: false, idle: 0 }
const state = { corruption: 0, scrollDepth: 0, lucid: 0, lucidTarget: 0, shock: 0, calm: false, touches: 0, lastTouch: -Infinity }
const heart = { phase: 0, pulse: 0, period: 1.1 }
let dread = null
let muted = localStorage.getItem(MUTED_KEY) === '1'
let shownWatching = -1, watchingCheckIn = 0

addEventListener('pointermove', event => {
	pointer.x = event.clientX
	pointer.y = event.clientY
	pointer.present = true
	pointer.idle = 0
}, { passive: true })
document.documentElement.addEventListener('pointerleave', () => { pointer.present = false })
addEventListener('scroll', () => {
	const range = document.documentElement.scrollHeight - innerHeight
	state.scrollDepth = Math.max(state.scrollDepth, range > 0 ? scrollY / range : 0)
}, { passive: true })
wayOut.addEventListener('pointerenter', () => {
	state.calm = true
	dread?.setCalm(true)
})
wayOut.addEventListener('pointerleave', () => {
	state.calm = false
	dread?.setCalm(false)
})

/** 按住非交互区域一会儿：世界变得干净、明亮——而眼睛只是缩成了针孔。 */
let holdTimer = 0, holdStart = null
addEventListener('pointerdown', event => {
	if (event.button !== 0 || event.target.closest('a, button, select, label, input, textarea')) return
	holdStart = { x: event.clientX, y: event.clientY }
	clearTimeout(holdTimer)
	holdTimer = setTimeout(() => setLucid(true), LUCID_HOLD)
})
addEventListener('pointermove', event => {
	if (holdStart && Math.hypot(event.clientX - holdStart.x, event.clientY - holdStart.y) > 10 && !state.lucidTarget) {
		clearTimeout(holdTimer)
		holdStart = null
	}
}, { passive: true })
for (const type of ['pointerup', 'pointercancel', 'blur']) addEventListener(type, () => {
	clearTimeout(holdTimer)
	holdStart = null
	setLucid(false)
})

/**
 * 切换“看清”状态。
 * @param {boolean} lucid 是否看清。
 */
function setLucid(lucid) {
	if (Boolean(state.lucidTarget) === lucid) return
	state.lucidTarget = lucid ? 1 : 0
	body.classList.toggle('lucid', lucid)
	if (lucid) getSelection()?.removeAllRanges()
	dread?.setLucid(lucid)
}

document.addEventListener('visibilitychange', () => {
	document.title = geti18n(document.hidden ? 'proxy_exposure.away' : 'proxy_exposure.title')
})

const sound = document.getElementById('sound')
/** 按当前静音状态同步声音按钮的图标与说明。 */
function renderSound() {
	const playing = !muted
	sound.querySelector('.pe-sound-on').classList.toggle('hidden', !playing)
	sound.querySelector('.pe-sound-off').classList.toggle('hidden', playing)
	setElementI18n(sound, playing ? 'proxy_exposure.sound.on' : 'proxy_exposure.sound.off')
}
sound.addEventListener('click', () => {
	muted = !muted
	localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
	dread?.setMuted(muted)
	renderSound()
})
renderSound()
whenAudioAllowed(context => {
	dread = createDread(context)
	if (state.calm) dread.setCalm(true)
	if (state.lucidTarget) dread.setLucid(true)
	dread.setMuted(muted)
	renderSound()
})

/**
 * 量一次正文栏的位置：着色器在这一竖条里把血肉压暗，保证文字可读。
 * @returns {number[]} `[中心 x, 半宽, 过渡宽度, 压暗强度]`。
 */
function measureVeil() {
	const rect = main.getBoundingClientRect()
	return [rect.left + rect.width / 2, rect.width / 2 - 40, 180, 0.72]
}
let veil = measureVeil()
addEventListener('resize', () => { veil = measureVeil() })

/**
 * 被触手碰到：字浮在指针处，画面一抽，心跳加速，触手缩回去。
 */
function touch() {
	state.touches++
	state.shock = 1
	touched.style.setProperty('--touch-x', `${pointer.x}px`)
	touched.style.setProperty('--touch-y', `${pointer.y}px`)
	touched.classList.remove('is-on')
	void touched.offsetWidth
	touched.classList.add('is-on')
	tendrils.recoil(pointer)
	dread?.touch()
}

/**
 * 推进心跳：周期随腐化、触手距离与惊吓加快；返回本帧是否落下一拍。
 * @param {number} delta 帧间隔。
 * @param {number} nearest 最近触手尖端距离。
 * @returns {boolean} 是否刚好落拍。
 */
function beatHeart(delta, nearest) {
	const closeness = Number.isFinite(nearest) ? Math.max(0, 1 - nearest / 260) : 0
	const bpm = (state.calm ? 46 : 50 + state.corruption * 46 + closeness * 50) + state.shock * 40
	heart.period = 60 / bpm
	heart.phase += delta / heart.period
	const beat = heart.phase >= 1
	if (beat) heart.phase %= 1
	const lub = Math.exp(-heart.phase * heart.period * 14)
	const dub = heart.phase > 0.28 ? Math.exp(-(heart.phase - 0.28) * heart.period * 16) * 0.6 : 0
	heart.pulse = Math.min(1, lub + dub)
	return beat
}

const eyes = createEyes()
const tendrils = createTendrils(document.getElementById('tendrils'))

/**
 * 每帧：推进全部模拟并返回着色器 uniform。
 * @param {{ time: number, delta: number, width: number, height: number }} frame 帧信息。
 * @returns {Record<string, number | ArrayLike<number>>} uniform。
 */
function tick({ time, delta, width, height }) {
	pointer.idle += delta
	state.corruption = Math.min(1, time / CORRUPTION_SECONDS + state.scrollDepth * 0.35 + state.touches * 0.08)
	state.shock = Math.max(0, state.shock - delta * 1.4)
	state.lucid += (state.lucidTarget - state.lucid) * Math.min(1, delta * (state.lucidTarget ? 9 : 4))

	eyes.step({ delta, width, height, corruption: state.corruption, pointer, calm: state.calm })
	const nearest = tendrils.step({ time, delta, corruption: state.corruption, pointer, calm: state.calm || state.lucidTarget > 0 })
	if (nearest < 16 && time - state.lastTouch > TOUCH_COOLDOWN) {
		state.lastTouch = time
		touch()
	}
	if (beatHeart(delta, nearest)) dread?.beat(0.55 + state.corruption * 0.45, heart.period)
	dread?.update(state.corruption)
	omen.style.setProperty('--pulse', heart.pulse.toFixed(3))

	watchingCheckIn -= delta
	if (watchingCheckIn <= 0) {
		watchingCheckIn = 0.5
		const count = eyes.watching()
		if (count !== shownWatching) {
			shownWatching = count
			setElementI18n(watching, 'proxy_exposure.watching', { count })
		}
	}

	const lighting = {
		uPointer: [pointer.x, pointer.y],
		uLight: pointer.present ? 1 : 0.25,
		uCorruption: state.corruption,
		uPulse: heart.pulse,
		uLucid: state.lucid,
		uShock: state.shock,
		uVeil: veil,
	}
	tendrils.draw(lighting, time)
	return {
		...lighting,
		uScroll: scrollY,
		uDilate: Math.min(1, 0.25 + state.lucid * 0.6 + (pointer.present ? 0 : 0.5) + Math.min(0.4, pointer.idle / 10)),
		...eyes.uniforms(),
	}
}

let shader = { supported: false }
try {
	shader = createShaderCanvas(document.getElementById('flesh'), { fragment: FLESH_FRAGMENT, scale: 0.7, onFrame: tick })
}
catch (error) {
	console.warn('proxy-exposure: flesh shader unavailable', error)
}
if (shader.supported) shader.start()
else {
	body.classList.add('no-webgl')
	const startedAt = performance.now()
	let last = startedAt
	/**
	 * 无 WebGL2 时仍跑眼睛以外的模拟（触手、心跳、声音）。
	 * @param {number} now 时间戳。
	 */
	const loop = now => {
		requestAnimationFrame(loop)
		if (document.hidden) return
		tick({ time: (now - startedAt) / 1000, delta: Math.min(0.1, (now - last) / 1000), width: innerWidth, height: innerHeight })
		last = now
	}
	requestAnimationFrame(loop)
}

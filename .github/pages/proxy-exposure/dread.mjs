/**
 * 门后的声音：实时合成。低频持续音、永不落地的谢泼德下行音、与画面同步的心跳、四处游走的呼吸、微分音合唱、触碰尖啸，
 * 以及“清醒”时那一声干净得可疑的医院提示音。
 */
import { createImpulse, createNoiseBuffer, envelope } from '../scripts/lib/proceduralAudio.mjs'

const SHEPARD_VOICES = 7
const SHEPARD_BASE = 27.5
/** 一整轮谢泼德下行（跨一个八度）耗时（秒）。 */
const SHEPARD_CYCLE = 38

/**
 * 搭建声音图并返回控制句柄。
 * @param {AudioContext} context 已获准发声的上下文。
 * @returns {object} 控制句柄。
 */
export function createDread(context) {
	const master = context.createGain()
	master.gain.value = 0
	const compressor = context.createDynamicsCompressor()
	compressor.threshold.value = -18
	compressor.ratio.value = 6
	const muffle = context.createBiquadFilter()
	muffle.type = 'lowpass'
	muffle.frequency.value = 18000
	master.connect(muffle).connect(compressor).connect(context.destination)

	const reverb = context.createConvolver()
	reverb.buffer = createImpulse(context, 5, 2.4)
	const wet = context.createGain()
	wet.gain.value = 0.55
	reverb.connect(wet).connect(master)
	const noise = createNoiseBuffer(context, 3)

	const droneFilter = context.createBiquadFilter()
	droneFilter.type = 'lowpass'
	droneFilter.frequency.value = 160
	droneFilter.Q.value = 6
	const droneGain = context.createGain()
	droneGain.gain.value = 0.16
	droneFilter.connect(droneGain).connect(master)
	droneGain.connect(reverb)
	for (const [type, frequency] of [['sawtooth', 41.2], ['sawtooth', 41.44], ['sine', 82.1], ['triangle', 61.7]]) {
		const oscillator = context.createOscillator()
		oscillator.type = type
		oscillator.frequency.value = frequency
		oscillator.connect(droneFilter)
		oscillator.start()
	}
	const droneLfo = context.createOscillator()
	droneLfo.frequency.value = 0.07
	const droneLfoDepth = context.createGain()
	droneLfoDepth.gain.value = 70
	droneLfo.connect(droneLfoDepth).connect(droneFilter.frequency)
	droneLfo.start()

	const shepardBus = context.createGain()
	shepardBus.gain.value = 0.05
	shepardBus.connect(master)
	shepardBus.connect(reverb)
	const shepard = Array.from({ length: SHEPARD_VOICES }, () => {
		const oscillator = context.createOscillator()
		oscillator.type = 'sine'
		const gain = context.createGain()
		gain.gain.value = 0
		oscillator.connect(gain).connect(shepardBus)
		oscillator.start()
		return { oscillator, gain }
	})

	const heartBus = context.createGain()
	heartBus.gain.value = 0.9
	heartBus.connect(master)

	const hospital = context.createOscillator()
	hospital.frequency.value = 1046.5
	const hospitalGain = context.createGain()
	hospitalGain.gain.value = 0
	hospital.connect(hospitalGain).connect(compressor)
	hospital.start()

	let corruption = 0, nextBreath = context.currentTime + 2, choirLevel = 0, calm = false

	/**
	 * 一次“咚”：正弦从高处坠落的低音。
	 * @param {number} at 上下文时间。
	 * @param {number} strength 力度。
	 */
	function thump(at, strength) {
		const oscillator = context.createOscillator()
		const gain = context.createGain()
		oscillator.frequency.setValueAtTime(70, at)
		oscillator.frequency.exponentialRampToValueAtTime(32, at + 0.16)
		oscillator.connect(gain).connect(heartBus)
		oscillator.start(at)
		oscillator.stop(envelope(gain.gain, at, 0.9 * strength, 0.012, 0.22))
	}

	/** 一口呼吸/低语：带通噪声，共振峰随机，随机声像，送进混响。 */
	function breath() {
		const at = context.currentTime + 0.05
		const source = context.createBufferSource()
		source.buffer = noise
		source.loop = true
		const band = context.createBiquadFilter()
		band.type = 'bandpass'
		band.Q.value = 7 + Math.random() * 8
		const formant = 500 + Math.random() * 1800
		band.frequency.setValueAtTime(formant, at)
		band.frequency.linearRampToValueAtTime(formant * (0.6 + Math.random() * 0.8), at + 2)
		const pan = context.createStereoPanner()
		pan.pan.setValueAtTime(Math.random() * 2 - 1, at)
		pan.pan.linearRampToValueAtTime(Math.random() * 2 - 1, at + 2.2)
		const gain = context.createGain()
		source.connect(band).connect(gain).connect(pan)
		pan.connect(reverb)
		pan.connect(master)
		source.start(at, Math.random() * 2)
		source.stop(envelope(gain.gain, at, 0.22 + corruption * 0.25, 0.7 + Math.random() * 0.8, 1 + Math.random()))
	}

	/** 一团微分音合唱：几只略微走调的正弦缓慢升起又沉下去。 */
	function choir() {
		const at = context.currentTime + 0.05
		for (const cents of [0, 50, 150, 350, 650, 1150]) {
			const oscillator = context.createOscillator()
			oscillator.type = 'sine'
			oscillator.frequency.value = 196 * 2 ** (cents / 1200) * (1 + (Math.random() - 0.5) * 0.004)
			const vibrato = context.createOscillator()
			vibrato.frequency.value = 4 + Math.random() * 2
			const vibratoDepth = context.createGain()
			vibratoDepth.gain.value = 1.5
			vibrato.connect(vibratoDepth).connect(oscillator.frequency)
			const gain = context.createGain()
			oscillator.connect(gain).connect(reverb)
			oscillator.start(at)
			vibrato.start(at)
			const end = envelope(gain.gain, at, 0.035, 4.5, 7)
			oscillator.stop(end)
			vibrato.stop(end)
		}
	}

	/**
	 * 声门脉冲波形：谐波按 1/n^1.5 衰减，比锯齿柔，像真正的声带振动。
	 */
	const glottal = (() => {
		const imag = new Float32Array(48)
		for (let index = 1; index < imag.length; index++) imag[index] = 1 / index ** 1.5
		return context.createPeriodicWave(new Float32Array(imag.length), imag)
	})()

	/**
	 * 一个“嘴”：三个并联共振峰（近似元音 e/ə）汇到一个声像上，主要是干声，少量送进混响。
	 * @param {number} pan 声像。
	 * @param {number} level 音量。
	 * @returns {GainNode} 声源接入点。
	 */
	function mouth(pan, level) {
		const input = context.createGain()
		const output = context.createGain()
		output.gain.value = level
		for (const [frequency, q, gain] of [[540, 5, 1], [1700, 9, 0.45], [2550, 12, 0.22]]) {
			const band = context.createBiquadFilter()
			band.type = 'bandpass'
			band.frequency.value = frequency * (0.96 + Math.random() * 0.08)
			band.Q.value = q
			const bandGain = context.createGain()
			bandGain.gain.value = gain * 3
			input.connect(band).connect(bandGain).connect(output)
		}
		const panner = context.createStereoPanner()
		panner.pan.value = pan
		const send = context.createGain()
		send.gain.value = 0.2
		output.connect(panner).connect(master)
		panner.connect(send).connect(reverb)
		return input
	}

	/**
	 * 一段噪声（送气/鼻息）。
	 * @param {AudioNode} target 接到哪里。
	 * @param {number} at 开始时间。
	 * @param {number} peak 峰值。
	 * @param {number} attack 起音。
	 * @param {number} release 衰减。
	 */
	function hiss(target, at, peak, attack, release) {
		const source = context.createBufferSource()
		source.buffer = noise
		const gain = context.createGain()
		source.connect(gain).connect(target)
		source.start(at, Math.random() * 2)
		source.stop(envelope(gain.gain, at, peak, attack, release))
	}

	/**
	 * 嗤笑：先一声从鼻腔里哼出的“嗤”，再是一串越来越低、越来越漏气的“嘿”。
	 * 两张嘴同时在笑：一张在左耳，另一张低一个八度、晚 18 毫秒，在右耳。
	 * @param {number} start 开始时间。
	 */
	function chuckle(start) {
		const nose = context.createBiquadFilter()
		nose.type = 'bandpass'
		nose.frequency.value = 4200
		nose.Q.value = 0.9
		const noseGain = context.createGain()
		noseGain.gain.value = 1.4
		nose.connect(noseGain).connect(master)
		hiss(nose, start, 0.5, 0.015, 0.16)
		const syllables = 5 + Math.floor(Math.random() * 3)
		for (const [pitch, delay, pan, level] of [[1, 0, -0.35, 0.9], [0.5, 0.018, 0.4, 0.75]]) {
			const input = mouth(pan, level)
			let at = start + 0.2 + delay, f0 = 168 * pitch
			for (let index = 0; index < syllables; index++) {
				const fade = 1 - index / syllables
				hiss(input, at, 0.12 + 0.18 * (1 - fade), 0.008, 0.05)
				const voice = context.createOscillator()
				voice.setPeriodicWave(glottal)
				const jitter = 1 + (Math.random() - 0.5) * 0.06
				voice.frequency.setValueAtTime(f0 * jitter, at + 0.03)
				voice.frequency.exponentialRampToValueAtTime(f0 * jitter * 0.86, at + 0.12)
				const gain = context.createGain()
				voice.connect(gain).connect(input)
				voice.start(at + 0.03)
				voice.stop(envelope(gain.gain, at + 0.03, 0.35 * (0.4 + 0.6 * fade), 0.008, 0.08))
				at += 0.11 + index * 0.014 + Math.random() * 0.025
				f0 *= 0.93
			}
		}
	}

	return {
		/**
		 * 每帧调用：推进谢泼德音、呼吸与合唱调度、各层强度。
		 * @param {number} nextCorruption 腐化程度 0..1。
		 */
		update(nextCorruption) {
			corruption = nextCorruption
			const now = context.currentTime
			const cycle = now / SHEPARD_CYCLE % 1
			shepard.forEach(({ oscillator, gain }, index) => {
				const position = ((index - cycle) % SHEPARD_VOICES + SHEPARD_VOICES) % SHEPARD_VOICES / SHEPARD_VOICES
				oscillator.frequency.setTargetAtTime(SHEPARD_BASE * 2 ** (position * SHEPARD_VOICES), now, 0.05)
				gain.gain.setTargetAtTime(Math.sin(position * Math.PI) ** 2, now, 0.05)
			})
			shepardBus.gain.setTargetAtTime(calm ? 0.015 : 0.03 + corruption * 0.06, now, 0.5)
			droneGain.gain.setTargetAtTime(calm ? 0.07 : 0.12 + corruption * 0.12, now, 0.8)
			if (now > nextBreath) {
				if (!calm) breath()
				nextBreath = now + (calm ? 9 : 2 + Math.random() * (9 - corruption * 6))
			}
			const level = Math.floor(corruption * 5)
			if (level > choirLevel) {
				choirLevel = level
				choir()
			}
		},
		/**
		 * 与画面同步的心跳（一次“扑通”两声）。
		 * @param {number} strength 力度 0..1。
		 * @param {number} period 当前心跳周期（秒）。
		 */
		beat(strength, period) {
			const at = context.currentTime + 0.02
			thump(at, strength)
			thump(at + period * 0.28, strength * 0.65)
		},
		/** 被触手碰到：贴着耳边的一声嗤笑 + 一记重心跳。 */
		touch() {
			const at = context.currentTime + 0.01
			chuckle(at)
			thump(at, 1.3)
		},
		/**
		 * 清醒：一切被闷住，只剩一声过分干净的提示音；松开时一声湿漉漉的回落。
		 * @param {boolean} lucid 是否清醒。
		 */
		setLucid(lucid) {
			const now = context.currentTime
			muffle.frequency.setTargetAtTime(lucid ? 260 : 18000, now, lucid ? 0.08 : 0.3)
			hospitalGain.gain.setTargetAtTime(lucid ? 0.025 : 0, now, 0.1)
			if (lucid) return
			const source = context.createBufferSource()
			source.buffer = noise
			const sweep = context.createBiquadFilter()
			sweep.type = 'lowpass'
			sweep.Q.value = 12
			sweep.frequency.setValueAtTime(150, now)
			sweep.frequency.exponentialRampToValueAtTime(2400, now + 0.35)
			const gain = context.createGain()
			source.connect(sweep).connect(gain).connect(master)
			source.start(now)
			source.stop(envelope(gain.gain, now, 0.5, 0.05, 0.4))
		},
		/**
		 * 指针停在“出路”上：一切放轻。
		 * @param {boolean} next 是否平静。
		 */
		setCalm(next) {
			calm = next
		},
		/**
		 * 静音开关（淡入淡出，不打断声音图）。
		 * @param {boolean} next 是否静音。
		 */
		setMuted(next) {
			master.gain.setTargetAtTime(next ? 0 : 0.8, context.currentTime, next ? 0.15 : 1.2)
		},
	}
}

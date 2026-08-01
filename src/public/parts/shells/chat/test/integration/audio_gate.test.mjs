/**
 * audioGate 迟滞 VAD 单测。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createAudioGate, pcmRms } from '../../public/shared/audioGate.mjs'

/**
 * 伪 AudioData，用于无 WebCodecs 环境的 gate 单测。
 * @typedef {object} FakeAudioData
 * @property {number} numberOfChannels 声道数
 * @property {number} numberOfFrames 每声道帧数
 * @property {number} sampleRate 采样率（Hz）
 * @property {(out: Float32Array, options: { planeIndex: number }) => void} copyTo 拷贝 PCM 平面
 */

/**
 * 将单声道 PCM 平面写入伪 AudioData 目标缓冲。
 * @param {Float32Array} out 目标缓冲
 * @param {{ planeIndex: number }} options 声道索引
 * @param {Float32Array} plane 源 PCM
 * @returns {void}
 */
function copyFakePlane(out, { planeIndex }, plane) {
	if (planeIndex === 0) out.set(plane)
}

Deno.test('pcmRms silent is near zero', () => {
	const silent = new Float32Array(480)
	assert(pcmRms(silent) < 0.001)
})

Deno.test('audioGate opens on loud frame and closes after hangover', () => {
	const gate = createAudioGate({ threshold: 0.05, hangoverMs: 50 })
	const loud = new Float32Array(480)
	for (let i = 0; i < loud.length; i++) loud[i] = Math.sin(i / 4) * 0.5
	const quiet = new Float32Array(480)

	/**
	 * 从 PCM 平面构造伪 AudioData。
	 * @param {Float32Array} plane PCM 单声道采样
	 * @returns {FakeAudioData} 伪 AudioData
	 */
	const fakeAudioData = plane => ({
		numberOfChannels: 1,
		numberOfFrames: plane.length,
		sampleRate: 48_000,
		/**
		 * @param {Float32Array} out 目标缓冲
		 * @param {{ planeIndex: number }} options 声道索引
		 * @returns {void}
		 */
		copyTo: (out, options) => copyFakePlane(out, options, plane),
	})

	assertEquals(gate.update(fakeAudioData(loud)), true)
	assertEquals(gate.isOpen(), true)
	assertEquals(gate.update(fakeAudioData(quiet)), true, 'hangover keeps gate open')
	const t0 = performance.now()
	while (performance.now() - t0 < 60) gate.update(fakeAudioData(quiet))
	assertEquals(gate.update(fakeAudioData(quiet)), false, 'gate closes after hangover')
})

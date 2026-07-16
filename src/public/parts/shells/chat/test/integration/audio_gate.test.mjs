/**
 * audioGate 迟滞 VAD 单测。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createAudioGate, pcmRms } from '../../public/shared/audioGate.mjs'

/**
 * @typedef {object} FakeAudioData
 * @property {number} numberOfChannels
 * @property {number} numberOfFrames
 * @property {number} sampleRate
 * @property {(out: Float32Array, opts: { planeIndex: number }) => void} copyTo
 */

/**
 * @param {Float32Array} out 目标缓冲
 * @param {{ planeIndex: number }} opts 声道索引
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
	 * @param {Float32Array} plane PCM 单声道采样
	 * @returns {FakeAudioData} 伪 AudioData
	 */
	const fakeAudioData = plane => ({
		numberOfChannels: 1,
		numberOfFrames: plane.length,
		sampleRate: 48_000,
		/**
		 * @param {Float32Array} out 目标缓冲
		 * @param {{ planeIndex: number }} opts 声道索引
		 * @returns {void}
		 */
		copyTo: (out, opts) => copyFakePlane(out, opts, plane),
	})

	assertEquals(gate.update(fakeAudioData(loud)), true)
	assertEquals(gate.isOpen(), true)
	assertEquals(gate.update(fakeAudioData(quiet)), true, 'hangover keeps gate open')
	const t0 = performance.now()
	while (performance.now() - t0 < 60) gate.update(fakeAudioData(quiet))
	assertEquals(gate.update(fakeAudioData(quiet)), false, 'gate closes after hangover')
})

/**
 * audioGate 迟滞 VAD 单测。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createAudioGate, pcmRms } from '../../public/shared/audioGate.mjs'

Deno.test('pcmRms silent is near zero', () => {
	const silent = new Float32Array(480)
	assert(pcmRms(silent) < 0.001)
})

Deno.test('audioGate opens on loud frame and closes after hangover', () => {
	const gate = createAudioGate({ threshold: 0.05, hangoverMs: 50 })
	const loud = new Float32Array(480)
	for (let i = 0; i < loud.length; i++) loud[i] = Math.sin(i / 4) * 0.5
	const quiet = new Float32Array(480)

	/** @param {Float32Array} plane */
	const fakeAudioData = plane => ({
		numberOfChannels: 1,
		numberOfFrames: plane.length,
		sampleRate: 48_000,
		copyTo: (out, { planeIndex }) => { if (planeIndex === 0) out.set(plane) },
	})

	assertEquals(gate.update(fakeAudioData(loud)), true)
	assertEquals(gate.isOpen(), true)
	assertEquals(gate.update(fakeAudioData(quiet)), true, 'hangover keeps gate open')
	const t0 = performance.now()
	while (performance.now() - t0 < 60) gate.update(fakeAudioData(quiet))
	assertEquals(gate.update(fakeAudioData(quiet)), false, 'gate closes after hangover')
})

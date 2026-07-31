/**
 * Pure tests: animation lifecycle, exit boundary, resize migration, frame size.
 */
/* global Deno */
import { assert, assertEquals, assertGreater } from 'jsr:@std/assert'

import { addLiquid, spawnParticle } from '../fluid_engine.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit, renderGrid, layout,
} from '../index.mjs'

Deno.test('layout: ICON_W matches packed bitmap', () => {
	assertEquals(layout.ICON_W, 42)
	assertEquals(layout.ICON_PACK_H, 20)
	assertEquals(layout.ICON_H, 23)
})

Deno.test('createAnimState: fixed seed + size', () => {
	const a = createAnimState({ width: 60, height: 30, seed: 1 })
	const b = createAnimState({ width: 60, height: 30, seed: 1 })
	assertEquals([...a.terrain.surface], [...b.terrain.surface])
	assertEquals(a.width, 60)
	assertEquals(a.height, 30)
})

Deno.test('enter: reaches full icon', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 3 })
	let frames = 0
	for (const _ of enter(state)) frames++
	assertGreater(frames, 10)
	assertEquals(state.baseBot, layout.BASE_WIDTH)
	assertEquals(state.pillars, layout.maxPillarH)
	assertEquals(state.bodyReach, layout.maxBodyD)
})

Deno.test('exit: ends when icon gone without draining rain wait', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 5 })
	for (const _ of enter(state));
	// inject leftover liquid + particles
	addLiquid(state.world, state.world.ox + 10, 10, 1)
	spawnParticle(state.world, state.world.ox + 5, 2, 0, 0.5, 40)
	const beforeParticles = state.world.particles.length
	assertGreater(beforeParticles, 0)

	let frames = 0
	let last = ''
	for (const frame of exit(state)) {
		frames++
		last = frame
	}
	assertGreater(frames, 5)
	// icon progress cleared
	assertEquals(state.baseBot, 0)
	assertEquals(state.pillars, 0)
	assertEquals(state.bodyReach, -1)
	// final frame is empty grid of exact size
	const lines = last.split('\n')
	assertEquals(lines.length, state.height)
	assertEquals(lines[0].replace(/\x1b\[[0-9;]*m/g, '').length, state.width)
	// exit must be shorter than old 90-frame drain budget
	assert(frames < 90 + layout.maxBodyD + layout.maxPillarH * 2 + layout.BASE_WIDTH)
})

Deno.test('hold: yields at least one frame', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	const first = gen.next()
	assertEquals(first.done, false)
	assert(typeof first.value === 'string')
	gen.return?.()
})

Deno.test('resizeAnimState: preserves seed and stage, changes size', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 11 })
	state.baseBot = state.baseTop = layout.BASE_WIDTH
	state.pillars = layout.maxPillarH
	state.bodyReach = layout.maxBodyD
	state.frame = 40
	addLiquid(state.world, state.world.ox + 8, 12, 0.8)

	resizeAnimState(state, { width: 70, height: 36 })
	assertEquals(state.width, 70)
	assertEquals(state.height, 36)
	assertEquals(state.seed, 11)
	assertEquals(state.pillars, layout.maxPillarH)
	assertEquals(state.frame, 40)
	assertEquals(state.terrain.surface.length, state.world.worldW)
})

Deno.test('renderGrid: fixed height/width', () => {
	const width = 10
	const height = 4
	const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => null))
	grid[1][2] = { ch: 'x', fg: '\x1b[31m' }
	const text = renderGrid(grid, width, height)
	const lines = text.split('\n')
	assertEquals(lines.length, height)
	const plain = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
	for (const line of plain) assertEquals(line.length, width)
})

Deno.test('sim frame from enter has correct dimensions', () => {
	const state = createAnimState({ width: 55, height: 30, seed: 2 })
	const gen = enter(state)
	const { value } = gen.next()
	const lines = value.split('\n')
	assertEquals(lines.length, 30)
	const plain0 = lines[0].replace(/\x1b\[[0-9;]*m/g, '')
	assertEquals(plain0.length, 55)
	gen.return?.()
})

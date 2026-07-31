/**
 * Pure tests: animation lifecycle, exit boundary, resize migration, frame size.
 */
/* global Deno */
import { assert, assertEquals, assertGreater } from 'jsr:@std/assert'

import { MAT, addLiquid, spawnParticle, idx } from '../fluid_engine.mjs'
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

Deno.test('hold: pillars leave AIR so liquid passes the jet columns', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world, iconOx, iconOy } = state
	// Three :: pillars at local x 16/20/24, mid-height of the jet
	for (const lx of [16, 20, 24]) {
		const x = iconOx + lx
		const y = iconOy + 8
		assertEquals(world.mat[idx(world, x, y)], MAT.AIR)
		assertEquals(world.mat[idx(world, x + 1, y)], MAT.AIR)
		assertGreater(addLiquid(world, x, y, 0.8), 0.7)
	}
	gen.return?.()
})

Deno.test('hold: BODY impact leaves no pooled liquid in the silhouette', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world } = state
	let bodyCells = 0
	for (let y = 0; y < world.worldH; y++)
		for (let x = 0; x < world.worldW; x++)
			if (world.mat[idx(world, x, y)] === MAT.BODY) {
				assertEquals(addLiquid(world, x, y, 1), 0)
				bodyCells++
			}
	assertGreater(bodyCells, 0)

	// Drop a particle onto a body cell — after a frame it must not leave fill in BODY
	let bx = -1, by = -1
	for (let y = 0; y < world.worldH && bx < 0; y++)
		for (let x = 0; x < world.worldW; x++)
			if (world.mat[idx(world, x, y)] === MAT.BODY) {
				bx = x
				by = y
				break
			}
	spawnParticle(world, bx + 0.2, by - 1.2, 0, 0.8, 40)
	const { value: frame } = gen.next()
	assertEquals(world.liq[idx(world, bx, by)], 0)
	assert(typeof frame === 'string')
	gen.return?.()
})

Deno.test('hold: pool liquid leaks to the next base slab', () => {
	const state = createAnimState({ width: 48, height: 26, seed: 8 })
	const gen = hold(state)
	assertEquals(gen.next().done, false)

	const { world, iconOx, iconOy } = state
	const upper = iconOy + layout.ICON_BASE_ROWS[0]
	const lower = iconOy + layout.ICON_BASE_ROWS[1]
	const x = iconOx + layout.ICON_BASE_ROWS.length + 12
	assertEquals(world.mat[idx(world, x, upper)], MAT.POOL)
	assertEquals(world.mat[idx(world, x, lower)], MAT.POOL)

	addLiquid(world, x, upper, 1)
	for (let i = 0; i < 12; i++) gen.next()

	assertGreater(world.liq[idx(world, x, lower)], 0.05)
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

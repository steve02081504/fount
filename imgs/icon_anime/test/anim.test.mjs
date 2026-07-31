/**
 * Pure tests: animation lifecycle, exit boundary, resize migration, frame size.
 */
/* global Deno */
import { assert, assertEquals, assertGreater } from 'jsr:@std/assert'

import { MAT, addLiquid, spawnParticle, idx } from '../fluid/index.mjs'
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
	const beforeParticles = state.world.particles.count
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
	assertEquals(lines[0].replace(/\x1b\[[\d;]*m/g, '').length, state.width)
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

Deno.test('resizeAnimState: preserves terrain and weathers only newly exposed soil', () => {
	const state = createAnimState({ width: 50, height: 28, seed: 11 })
	state.baseBot = state.baseTop = layout.BASE_WIDTH
	state.pillars = layout.maxPillarH
	state.bodyReach = layout.maxBodyD
	state.frame = 40
	addLiquid(state.world, state.world.ox + 8, 12, 0.8)
	const oldTerrain = state.terrain
	const oldIconOx = state.iconOx
	const oldIconOy = state.iconOy

	resizeAnimState(state, { width: 70, height: 36 })
	assertEquals(state.width, 70)
	assertEquals(state.height, 36)
	assertEquals(state.seed, 11)
	assertEquals(state.pillars, layout.maxPillarH)
	assertEquals(state.frame, 40)
	assertEquals(state.terrain.surface.length, state.world.worldW)

	const dx = state.iconOx - oldIconOx
	const dy = state.iconOy - oldIconOy
	for (let x = 0; x < oldTerrain.worldW; x++)
		assertEquals(state.terrain.surface[x + dx], oldTerrain.surface[x] + dy)
	for (let y = 0; y < oldTerrain.worldH; y++)
		for (let x = 0; x < oldTerrain.worldW; x++)
			assertEquals(
				state.terrain.solid[(y + dy) * state.world.worldW + x + dx],
				oldTerrain.solid[y * oldTerrain.worldW + x],
			)

	let wetAddedSoil = 0
	for (let y = 0; y < state.world.worldH; y++)
		for (let x = 0; x < state.world.worldW; x++) {
			const fromOld = x >= dx && x < dx + oldTerrain.worldW &&
				y >= dy && y < dy + oldTerrain.worldH
			const i = idx(state.world, x, y)
			if (!fromOld && state.terrain.solid[i] && state.world.moisture[i] > 0)
				wetAddedSoil++
		}
	assertGreater(wetAddedSoil, 0)
})

Deno.test('renderGrid: fixed height/width', () => {
	const width = 10
	const height = 4
	const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => null))
	grid[1][2] = { ch: 'x', fg: '\x1b[31m' }
	const text = renderGrid(grid, width, height)
	const lines = text.split('\n')
	assertEquals(lines.length, height)
	const plain = lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ''))
	for (const line of plain) assertEquals(line.length, width)
})

Deno.test('lightFalloff: center bright, edge zero, soft circle', async () => {
	const { lightFalloff, LIGHT_RADIUS } = await import('../compose.mjs')
	assertEquals(lightFalloff(0, 0), 1)
	assertEquals(lightFalloff(LIGHT_RADIUS, 0), 0)
	assertEquals(lightFalloff(0, LIGHT_RADIUS), 0)
	assert(lightFalloff(3, 0) > lightFalloff(8, 0))
	// Aspect: one cell in y ≈ two cells in x visually
	assertEquals(lightFalloff(4, 0) > 0, true)
	assert(Math.abs(lightFalloff(4, 0) - lightFalloff(0, 2)) < 1e-9)
})

Deno.test('consumeStdin: SGR left/right press/drag/release + Ctrl+C', async () => {
	const { consumeStdin } = await import('../player.mjs')
	const events = []
	let aborted = false
	/**
	 * @returns {void}
	 */
	const abort = () => { aborted = true }
	/**
	 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} ev pointer
	 * @returns {void}
	 */
	const onPointer = (ev) => { events.push(ev) }
	/**
	 * @param {string} s ascii bytes
	 * @returns {Uint8Array} encoded
	 */
	const enc = (s) => Uint8Array.from(s, c => c.charCodeAt(0))
	const handlers = { abort, onPointer }
	let carry = ''
	carry = consumeStdin(carry, enc('\x1b[<0;5;8M'), handlers)
	assertEquals(carry, '')
	assertEquals(events.at(-1), { x: 4, y: 7, left: true })
	carry = consumeStdin(carry, enc('\x1b[<32;12;9M'), handlers)
	assertEquals(events.at(-1), { x: 11, y: 8, left: true })
	carry = consumeStdin(carry, enc('\x1b[<0;12;9m'), handlers)
	assertEquals(events.at(-1), { x: 11, y: 8, left: false })
	// Right press / drag / release
	carry = consumeStdin(carry, enc('\x1b[<2;6;4M'), handlers)
	assertEquals(events.at(-1), { x: 5, y: 3, right: true })
	carry = consumeStdin(carry, enc('\x1b[<34;10;5M'), handlers)
	assertEquals(events.at(-1), { x: 9, y: 4, right: true })
	carry = consumeStdin(carry, enc('\x1b[<2;10;5m'), handlers)
	assertEquals(events.at(-1), { x: 9, y: 4, right: false })
	// Wheel ignored
	const n = events.length
	consumeStdin('', enc('\x1b[<64;1;1M'), handlers)
	assertEquals(events.length, n)
	// Middle ignored
	consumeStdin('', enc('\x1b[<1;2;2M'), handlers)
	assertEquals(events.length, n)
	// Split CSI across chunks
	carry = consumeStdin('', enc('\x1b[<0;3;5'), handlers)
	assert(carry.length > 0)
	carry = consumeStdin(carry, enc('M'), handlers)
	assertEquals(carry, '')
	assertEquals(events.at(-1), { x: 2, y: 4, left: true })
	consumeStdin('', Uint8Array.of(0x03), handlers)
	assertEquals(aborted, true)
})

Deno.test('wind gesture: stroke speed + clockwise vortex + release clear', async () => {
	const {
		createWindGesture, windPointer, tickWindGesture, fillWindDrive,
		VORTEX_DELAY, STILL_EPS,
	} = await import('../wind_gesture.mjs')
	const { createWorld, scratch } = await import('../fluid/world.mjs')
	const world = createWorld({ width: 40, height: 24, margin: 4, bottomExtra: 2 })
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'tUx', n, Float32Array)
	const driveUy = scratch(world, 'tUy', n, Float32Array)
	const g = createWindGesture()

	// Fast rightward drag → positive ux along the stroke
	windPointer(g, { x: 10, y: 8, right: true })
	tickWindGesture(g) // arm at rest
	windPointer(g, { x: 10 + STILL_EPS + 4, y: 8, right: true })
	tickWindGesture(g)
	assert(g.strokes.length >= 1)
	assert(g.strokes.at(-1).ux > 0.5)
	fillWindDrive(g, world, driveUx, driveUy)
	const mid = (8 + world.oy) * world.worldW + (12 + world.ox)
	assert(driveUx[mid] > 0.2)

	// Long still → clockwise vortex (top of ring blows right)
	const g2 = createWindGesture()
	windPointer(g2, { x: 20, y: 10, right: true })
	for (let i = 0; i < VORTEX_DELAY + 8; i++) tickWindGesture(g2)
	assertEquals(g2.vortexOn, true)
	assert(g2.strength > 0.2)
	fillWindDrive(g2, world, driveUx, driveUy)
	const top = (8 + world.oy) * world.worldW + (20 + world.ox) // above centre
	const right = (10 + world.oy) * world.worldW + (23 + world.ox)
	assert(driveUx[top] > 0.05, 'clockwise: above centre → +ux')
	assert(driveUy[right] > 0.02, 'clockwise: right of centre → +uy')

	// Drag while vortex on → centre follows; stop reforms
	windPointer(g2, { x: 28, y: 10, right: true })
	tickWindGesture(g2)
	assertEquals(g2.vortexOn, true)
	assertEquals(g2.x, 28)
	tickWindGesture(g2) // still at new spot → regenerate path
	assertEquals(g2.vortexOn, true)

	windPointer(g2, { x: 28, y: 10, right: false })
	assertEquals(g2.down, false)
	assertEquals(g2.vortexOn, false)
	fillWindDrive(g2, world, driveUx, driveUy)
	assertEquals(driveUx[top], 0)
})

Deno.test('stepGas: pointer drive accelerates local gas', async () => {
	const { createWorld, labelAirRegions, stepGas, scratch } = await import('../fluid/index.mjs')
	const w = createWorld({ width: 30, height: 16, margin: 2, bottomExtra: 1 })
	labelAirRegions(w)
	const n = w.worldW * w.worldH
	const driveUx = scratch(w, 'dUx', n, Float32Array)
	const driveUy = scratch(w, 'dUy', n, Float32Array)
	const cx = w.ox + 15
	const cy = 6
	const cell = cy * w.worldW + cx
	driveUx[cell] = 2.0
	for (let i = 0; i < 12; i++)
		stepGas(w, { time: i, seed: 0, forceWind: 0, driveUx, driveUy })
	assert(w.gasUx[cell] > 0.6)
})

Deno.test('composeFrame: light yields truecolor near cursor', async () => {
	const { composeFrame } = await import('../compose.mjs')
	const state = createAnimState({ width: 40, height: 20, seed: 9 })
	for (const _ of enter(state));
	state.light = { x: 20, y: 10 }
	const lit = composeFrame(state)
	assert(lit.includes('\x1b[38;2;'))
	state.light = null
	const dark = composeFrame(state)
	assertEquals(dark.includes('\x1b[38;2;'), false)
})

Deno.test('sim frame from enter has correct dimensions', () => {
	const state = createAnimState({ width: 55, height: 30, seed: 2 })
	const gen = enter(state)
	const { value } = gen.next()
	const lines = value.split('\n')
	assertEquals(lines.length, 30)
	const plain0 = lines[0].replace(/\x1b\[[\d;]*m/g, '')
	assertEquals(plain0.length, 55)
	gen.return?.()
})

/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'

import { InputDecoder } from '../../../../../../scripts/terminal_ui/input.mjs'
import { TerminalScreen } from '../../../../../../scripts/terminal_ui/screen.mjs'
import { cells, replaceCells, sliceCells, wrap } from '../../../../../../scripts/terminal_ui/text.mjs'
import { createTitleGesture, runTui } from '../../cli/tui.mjs'

const assertEquals = assert.deepEqual

/**
 * 建一个带草稿接口默认实现的 TUI 客户端；真实客户端总有这两个方法。
 * @param {object} overrides - 测试要覆盖的字段。
 * @returns {object} 测试客户端。
 */
const testClient = overrides => ({
	t: key => key,
	loadDraft: async () => '',
	saveDraft: async () => { },
	subscribeServerEvents: async () => { },
	...overrides,
	state: { workspaceId: 'ws', sessionId: 'one', session: { entries: [] }, ...overrides.state },
})

Deno.test('terminal input preserves split mouse, paste, UTF-8, and modified Enter', () => {
	const decoder = new InputDecoder()
	assertEquals(decoder.push('\x1b[<0;3;'), [])
	assertEquals(decoder.push('2M'), [{ type: 'mouse', x: 2, y: 1, button: 0, shift: false, motion: false, action: 'press' }])
	assertEquals(decoder.push('\x1b[200~中\r\n\x1b[20'), [])
	assertEquals(decoder.push('1~'), [{ type: 'paste', text: '中\n' }])
	assertEquals(decoder.push('\x1b[13;2u'), [{ type: 'key', key: 'newline' }])
	const encoded = new TextEncoder().encode('🙂')
	assertEquals(decoder.push(encoded.slice(0, 2)), [])
	assertEquals(decoder.push(encoded.slice(2)), [{ type: 'text', text: '🙂' }])
	assertEquals(decoder.push('\x1b[O'), [{ type: 'focus', focused: false }])
	assertEquals(decoder.push('\x1b[Z\x1b[1;5H\x1b[1;5F'), [{ type: 'key', key: 'shift-tab' }, { type: 'key', key: 'ctrl-home' }, { type: 'key', key: 'ctrl-end' }])
	assertEquals(decoder.push('\x08'), [{ type: 'key', key: 'backspace' }])
	assertEquals(decoder.push('\x1b'), [])
	assertEquals(decoder.needsEscapeTimeout, true)
	assertEquals(decoder.flushEscape(), [{ type: 'key', key: 'escape' }])
})

Deno.test('terminal cells account for Chinese and emoji graphemes', () => {
	assertEquals(cells('a中🙂👩‍💻'), 7)
	assertEquals(wrap('ab中cd', 4), ['ab中', 'cd'])
	assertEquals(sliceCells('a中🙂', 1, 3), '中')
	assertEquals(replaceCells('ab中cd', 3, 2, 'X', 6), 'ab X d')
})

Deno.test('title press and hold have no idle timer', async () => {
	const gesture = createTitleGesture({
		invalidate() {}, holdMs: 15, frameMs: 5 })
	assertEquals(gesture.activeTimers, 0)
	gesture.press()
	assert(gesture.activeTimers > 0)
	await new Promise(resolve => setTimeout(resolve, 30))
	assertEquals(gesture.state, 'held')
	gesture.release()
	assertEquals(gesture.activeTimers, 0)
	gesture.press()
	gesture.cancel()
	assertEquals(gesture.activeTimers, 0)
})

Deno.test('transcript entries render through the shared formatter', async () => {
	class Stream extends EventEmitter {
		isRaw = false
		columns = 40
		rows = 20
		writes = []
		setRawMode(value) { this.isRaw = value }
		resume() {}
		pause() {}
		write(value) { this.writes.push(value) }
	}
	const stdin = new Stream()
	const stdout = new Stream()
	const entries = [
		{ id: 'e1', role: 'char', name: 'coder', content: '# 结果\n正文' },
		{ id: 'e2', role: 'tool', name: 'run-js', content: 'internal', content_for_show: '工具输出',
			extension: { toolCall: { summary: 'Inspect file' } } },
		{ id: 'e3', role: 'user', content: '我的问题' },
	]
	const client = testClient({
		state: { session: { entries } },
		attach: async () => { },
	})
	const result = runTui({ client, argv: { attach: true }, stdin, stdout })
	await new Promise(resolve => setTimeout(resolve, 0))
	const painted = stdout.writes.join('')
	// 角色标题不带 Markdown 标记、正文照常换行；工具条目折叠时只留摘要行；用户条目保留在 transcript
	assert(painted.includes('◆ coder'))
	assert(painted.includes('正文'))
	assert(!painted.includes('## coder'))
	assert(painted.includes('⚙ run-js: Inspect file ▾'))
	assert(!painted.includes('工具输出'))
	assert(!painted.includes('internal'))
	assert(painted.includes('我的问题'))
	stdin.emit('data', '\x04')
	assertEquals(await result, 0)
})

Deno.test('screen restores raw mode and terminal protocols', () => {
	const writes = []
	const stdin = { isRaw: false,
		setRawMode(value) { this.isRaw = value },
		resume() {},
		pause() {} }
	const stdout = { columns: 20, rows: 8,
		write(value) { writes.push(value) } }
	const screen = new TerminalScreen({ stdin, stdout })
	screen.enter()
	assertEquals(stdin.isRaw, true)
	screen.paint(['中🙂'], { x: 2, y: 1 })
	screen.paint(['中🙂'], { x: 2, y: 1 }, ['1;36'])
	assert(writes.join('').includes('\x1b[1;36m中🙂'))
	screen.leave()
	assertEquals(stdin.isRaw, false)
	assert(writes.join('').includes('\x1b[?1049h'))
	assert(writes.join('').includes('\x1b[?1049l'))
	assert(writes.join('').includes('\x1b[?1006l'))
})

Deno.test('screen restores raw mode when terminal output fails during cleanup', () => {
	const stdin = { isRaw: false, setRawMode(value) { this.isRaw = value }, resume() {}, pause() {} }
	let writes = 0
	const stdout = { write() { if (++writes === 2) throw new Error('broken terminal') } }
	const screen = new TerminalScreen({ stdin, stdout })
	screen.enter()
	assertEquals(stdin.isRaw, true)
	assert.throws(() => screen.leave(), /broken terminal/)
	assertEquals(stdin.isRaw, false)
})

Deno.test('mouse model picker selects item and Ctrl+D restores terminal', async () => {
	class Stream extends EventEmitter {
		isRaw = false
		columns = 80
		rows = 24
		writes = []
		setRawMode(value) { this.isRaw = value }
		resume() {}
		pause() {}
		write(value) { this.writes.push(value) }
	}
	const stdin = new Stream()
	const stdout = new Stream()
	const commands = []
	const client = testClient({
		state: { model: 'before' },
		list: async () => ['before', 'after'],
		command: async line => { commands.push(line); return {} },
	})
	const result = runTui({ client, stdin, stdout })
	stdin.emit('data', '\x1b[<0;3;2M\x1b[<0;3;2m')
	await new Promise(resolve => setTimeout(resolve, 0))
	stdin.emit('data', 'after\r')
	await new Promise(resolve => setTimeout(resolve, 0))
	stdin.emit('data', '\x04')
	assertEquals(await result, 0)
	assertEquals(commands, ['/model after'])
	assertEquals(stdin.isRaw, false)
	assert(stdout.writes.join('').includes('\x1b[?1049l'))
})

Deno.test('interactive attach follows runs and settles from server events', async () => {
	class Stream extends EventEmitter {
		isRaw = false
		columns = 80
		rows = 24
		writes = []
		setRawMode(value) { this.isRaw = value }
		resume() {}
		pause() {}
		write(value) { this.writes.push(value) }
	}
	const stdin = new Stream()
	const stdout = new Stream()
	const attached = []
	let busHandler
	let refreshes = 0
	const client = testClient({
		refreshSession: async () => { refreshes++; return { entries: [] } },
		attach: async ({ onEvent }) => { attached.push('attach'); onEvent({ type: 'done', status: 'done', entries: [] }); return { status: 'done' } },
		subscribeServerEvents: async ({ onEvent }) => { busHandler = onEvent },
		command: async () => ({}),
	})
	const result = runTui({ client, argv: { attach: true }, stdin, stdout })
	await new Promise(resolve => setTimeout(resolve, 0))
	assertEquals(attached.length, 1)
	busHandler({ type: 'entry', entry: { id: 'notice-1', role: 'system', content: 'async task finished' } })
	busHandler({ type: 'settled', runId: 'run-1', status: 'done' })
	busHandler({ type: 'run-started', runId: 'run-2' })
	await new Promise(resolve => setTimeout(resolve, 0))
	assertEquals(attached.length, 2)
	assert(refreshes > 0)
	assert(stdout.writes.join('').includes('\x07'))
	stdin.emit('data', '\x04')
	assertEquals(await result, 0)
	assertEquals(stdin.isRaw, false)
})

Deno.test('TUI restores a draft and Ctrl+C exits through an open picker', async () => {
	class Stream extends EventEmitter {
		isRaw = false
		columns = 80
		rows = 24
		writes = []
		setRawMode(value) { this.isRaw = value }
		resume() {}
		pause() {}
		write(value) { this.writes.push(value) }
	}
	const stdin = new Stream()
	const stdout = new Stream()
	const saves = []
	const client = testClient({
		loadDraft: async () => 'remembered',
		saveDraft: async (value, target) => { saves.push({ value, target }) },
		list: async () => ['char'],
	})
	const result = runTui({ client, stdin, stdout })
	await new Promise(resolve => setTimeout(resolve, 0))
	assert(stdout.writes.join('').includes('remembered'))
	stdin.emit('data', '\x03') // clear the restored draft
	stdin.emit('data', '\t') // open model picker
	await new Promise(resolve => setTimeout(resolve, 0))
	stdin.emit('data', '\x03') // exit even while picker has focus
	assertEquals(await result, 0)
	assertEquals(saves.at(-1), { value: '', target: { workspaceId: 'ws', sessionId: 'one' } })
	assertEquals(stdin.isRaw, false)
})

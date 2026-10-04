/** 托盘协议回归：日志与事件共用原生标准输出时保持就绪和点击正常。 */
/* global Deno */
import { EventEmitter } from 'node:events'

import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { adaptSysTrayProtocol } from '../../../scripts/systray_protocol.mjs'

Deno.test('systray diagnostics do not interrupt ready and click events', () => {
	/**
	 * 模拟原生托盘构造阶段的就绪注册。
	 */
	class NativeTray {
		/**
		 * 初始化模拟事件流。
		 */
		constructor() {
			this._rl = new EventEmitter()
			this.ready = 0
			this.onReady(() => this.ready++)
		}
	}
	const Tray = adaptSysTrayProtocol(NativeTray)
	const tray = new Tray()
	const clicked = []
	tray.onClick(action => clicked.push(action.seq_id))
	tray._rl.emit('line', 'DEBUG file: systray_windows.go: initialize icon')
	tray._rl.emit('line', '{"type":"ready"}')
	tray._rl.emit('line', 'DEBUG native tray initialized')
	tray._rl.emit('line', '{"type":"clicked","seq_id":2}')
	assertEquals(tray.ready, 1)
	assertEquals(clicked, [2])
	assertThrows(() => tray._rl.emit('line', '{broken-event'), SyntaxError)
})

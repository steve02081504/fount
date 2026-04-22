/**
 * 必须在加载 `scripts/i18n.mjs`（进而加载虚拟控制台代理）之前执行，
 * 以便默认 VirtualConsole 已启用结构化捕获与环形缓冲回调链。
 */
import { defaultConsole } from 'npm:@steve02081504/virtual-console'

import { chainServerLogRing } from './console_ring_buffer.mjs'

Object.assign(defaultConsole.options, {
	recordOutput: true,
	recordStructuredEntries: true,
	maxLogEntries: 12000,
	hookProcessStreams: true,
	stackIgnorePatterns: [/node_modules[\\/]/, /virtual-console[\\/]/],
})
chainServerLogRing(defaultConsole)

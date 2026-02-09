#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * fount IDE Agent：仅将 stdio 与 fount 的 ACP WebSocket 互相转发。
 * 用法一（推荐）：deno run "https://你的fount地址/parts/shells:ideIntegration/fount_ide_agent.mjs?fount-apikey=KEY&charname=角色id"
 * 用法二：本地运行时用环境变量 FOUNDT_URL、FOUNDT_API_KEY、FOUNDT_CHAR。
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import process from 'node:process'

const scriptUrl = import.meta?.url?.match(/^https?:\/\//)
	? new URL(import.meta.url)
	: null

const base = (scriptUrl?.origin || process.env.FOUNDT_URL || 'http://localhost:8931').replace(/\/+$/, '')
const apiKey = scriptUrl?.searchParams?.get?.('fount-apikey') || process.env.FOUNDT_API_KEY || '45450721'
const charname = scriptUrl?.searchParams?.get?.('charname') || process.env.FOUNDT_CHAR || 'ZL-31'

const wsPath = '/ws/parts/shells:ideIntegration/acp'
const params = new URLSearchParams()
if (charname) params.set('charname', charname)
const qs = params.toString()
const wsUrl = (base.startsWith('https') ? 'wss' : 'ws') + base.slice(base.indexOf('://')) + wsPath + (qs ? '?' + qs : '')

let buffer = ''

/**
 * 运行 IDE Agent。
 */
async function run() {
	const ws = new WebSocket(wsUrl, [apiKey])
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		/**
		 * WebSocket 错误处理。
		 * @param {object} event - 错误事件。
		 * @returns {void} 无返回值。
		 */
		ws.onerror = event => reject(event.error || new Error('WebSocket error'))
	})

	/**
	 * WebSocket 消息处理。
	 * @param {object} event - 消息事件。
	 */
	ws.onmessage = event => {
		const data = String(event.data || '')
		if (data) process.stdout.write(data)
	}
	/**
	 * WebSocket 关闭处理。
	 */
	ws.onclose = () => {
		process.exitCode = 0
	}
	/**
	 * WebSocket 错误处理。
	 */
	ws.onerror = () => {
		process.exitCode = 1
	}

	process.stdin.setEncoding('utf8')
	process.stdin.on('data', (chunk) => {
		buffer += chunk
		const lines = buffer.split('\n')
		buffer = lines.pop() || ''
		for (const line of lines)
			if (line.trim()) ws.send(line + '\n')
	})
}

run().catch((e) => {
	process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e.message } }) + '\n')
	process.exitCode = 1
	process.exit(1)
})

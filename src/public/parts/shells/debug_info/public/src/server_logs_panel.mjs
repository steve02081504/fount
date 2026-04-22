/**
 * 服务端控制台日志视图（调试 shell）。
 */

/**
 * @param {Record<string,string>} vars
 * @param {string} tpl
 */
function expandTemplate(tpl, vars) {
	let s = tpl ?? ''
	for (const [k, val] of Object.entries(vars))
		s = s.split(`{${k}}`).join(val ?? '')
	return s
}

/**
 * @param {{ editorCommandTemplate?: string }} cfg
 * @param {{ file?: string, line?: number, column?: number }} frame
 */
export function buildEditorOpenCommand(cfg, frame, keyword = '') {
	const tpl = cfg?.editorCommandTemplate ?? ''
	return expandTemplate(tpl, {
		file: frame.file ?? '',
		line: frame.line != null ? String(frame.line) : '',
		column: frame.column != null ? String(frame.column) : '',
		keyword,
	})
}

/**
 * @param {HTMLElement} container
 * @param {(key: string) => string} geti18n
 */
export async function mountServerLogsPanel(container, geti18n) {
	let seqMax = 0
	/** @type {{ editorCommandTemplate?: string }} */
	let editorCfg = {}
	try {
		const er = await fetch('/api/parts/shells:userSettings/editor_open_config', { credentials: 'include' })
		if (er.ok) {
			const j = await er.json()
			editorCfg = j.config ?? {}
		}
	}
	catch { /* ignore */ }

	const logBox = document.createElement('div')
	logBox.className = 'max-h-96 overflow-auto rounded-lg bg-base-300 p-3 text-xs font-mono whitespace-pre-wrap break-words space-y-4'
	container.appendChild(logBox)

	function appendEntryHtml(entry) {
		const wrap = document.createElement('div')
		wrap.className = 'border-l-2 border-primary pl-2 space-y-1'
		const htmlPart = document.createElement('div')
		htmlPart.className = 'log-html text-sm'
		htmlPart.innerHTML = entry.html ?? ''
		wrap.appendChild(htmlPart)

		if (entry.payload != null) {
			const det = document.createElement('details')
			det.className = 'text-xs opacity-90'
			const sum = document.createElement('summary')
			sum.textContent = geti18n('debug_info.serverLog.payload')
			det.appendChild(sum)
			const pre = document.createElement('pre')
			pre.className = 'mt-1 overflow-x-auto'
			try {
				pre.textContent = JSON.stringify(entry.payload, null, '\t')
			}
			catch {
				pre.textContent = String(entry.payload)
			}
			det.appendChild(pre)
			wrap.appendChild(det)
		}

		if (entry.stackFrames?.length) {
			const det = document.createElement('details')
			const sum = document.createElement('summary')
			sum.textContent = geti18n('debug_info.serverLog.stack')
			det.appendChild(sum)
			const ul = document.createElement('ul')
			ul.className = 'list-disc list-inside mt-1 space-y-1'
			for (const fr of entry.stackFrames) {
				const li = document.createElement('li')
				const cmd = buildEditorOpenCommand(editorCfg, fr)
				li.innerHTML = `<span class="opacity-80">${fr.file}:${fr.line}:${fr.column}</span>`
				if (cmd && editorCfg.editorCommandTemplate) {
					const btn = document.createElement('button')
					btn.type = 'button'
					btn.className = 'btn btn-xs btn-ghost ml-2'
					btn.textContent = geti18n('debug_info.serverLog.copyOpenCmd')
					btn.addEventListener('click', () => {
						navigator.clipboard.writeText(cmd).catch(() => 0)
					})
					li.appendChild(btn)
				}
				ul.appendChild(li)
			}
			det.appendChild(ul)
			wrap.appendChild(det)
		}

		logBox.appendChild(wrap)
		logBox.scrollTop = logBox.scrollHeight
	}

	try {
		const lr = await fetch('/api/server/logs?since=0', { credentials: 'include' })
		if (lr.ok) {
			const j = await lr.json()
			seqMax = j.seqMax ?? 0
			for (const e of j.entries ?? []) appendEntryHtml(e)
		}
	}
	catch { /* ignore */ }

	const hint = document.createElement('p')
	hint.className = 'text-xs opacity-70 mt-2'
	hint.textContent = geti18n('debug_info.serverLog.editorHint')
	container.appendChild(hint)

	const loc = globalThis.location
	const wsProto = loc.protocol === 'https:' ? 'wss' : 'ws'
	const ws = new WebSocket(`${wsProto}://${loc.host}/ws/server/logs`)
	ws.onmessage = ev => {
		try {
			const data = JSON.parse(String(ev.data))
			if (data.type === 'log' && data.entry) {
				appendEntryHtml(data.entry)
				if (typeof data.entry.seq === 'number') seqMax = data.entry.seq
			}
		}
		catch { /* ignore */ }
	}
}

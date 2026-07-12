/**
 * onMessage 探针 fixture 共享状态（globalThis，跨 user 目录复制后仍可用）。
 * @returns {{ events: object[], returnValue: boolean, reset: () => void }}
 */
export function onMessageProbeState() {
	const key = '__fountOnMessageProbe'
	if (!globalThis[key])
		globalThis[key] = { events: [], returnValue: true }
	return {
		get events() { return globalThis[key].events },
		get returnValue() { return globalThis[key].returnValue },
		set returnValue(value) { globalThis[key].returnValue = value },
		reset() {
			globalThis[key].events = []
			globalThis[key].returnValue = true
		},
	}
}

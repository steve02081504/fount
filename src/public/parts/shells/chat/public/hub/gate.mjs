/** Hub 全量 bootHub 完成后的就绪 signal（事件 `fount:hub-shell-*`）。 */
export const HUB_SHELL_GATE = {
	id: 'hub-shell',
	readyEvent: 'fount:hub-shell-ready',
	errorEvent: 'fount:hub-shell-error',
}

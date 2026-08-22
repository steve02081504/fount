import { resolveDisplayName } from './nameResolve.mjs'

/**
 * 角色私聊侧栏中 viewer 的展示名：优先异步就绪且非纯空白的 `viewerDisplayName`；
 * 否则回退到当前群 viewer 成员的 displayName（profile 名），最后落到 entityHash 短码。
 * 避免异步 profile 拉取（refreshViewerHubPresentation）尚未完成时渲染出空白名字。
 * @param {{ viewerDisplayName?: string | null, entityHash?: string | null, memberDisplayName?: string, alias?: string }} input 解析输入
 * @returns {string} viewer 展示名（绝不为空串）
 */
export function resolveViewerSidebarDisplayName({ viewerDisplayName, entityHash, memberDisplayName, alias = '' } = {}) {
	const trimmedViewer = viewerDisplayName?.trim()
	if (trimmedViewer) return trimmedViewer
	return resolveDisplayName({
		entityHash,
		alias,
		profileName: memberDisplayName,
	})
}

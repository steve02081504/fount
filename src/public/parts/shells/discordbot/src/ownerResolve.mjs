import { console } from '../../../../../scripts/i18n/bare.mjs'

/**
 * 解析 Owner 平台用户 id 与展示名。
 * @param {import('npm:discord.js').Client} client Discord 客户端
 * @param {{ OwnerUserID?: string, OwnerUserName?: string }} interfaceConfig 配置
 * @returns {Promise<{ platformUserId: string, displayName: string } | null>} 解析结果
 */
export async function resolveOwnerPlatformUserId(client, interfaceConfig) {
	const ownerUserId = String(interfaceConfig.OwnerUserID || '').trim()
	if (ownerUserId && !ownerUserId.toLowerCase().includes('your_')) {
		let displayName = ownerUserId
		try {
			const user = await client.users.fetch(ownerUserId)
			displayName = user.globalName || user.username || ownerUserId
		}
		catch { /* displayName 兜底 ownerUserId */ }
		return { platformUserId: ownerUserId, displayName }
	}

	const ownerUserName = String(interfaceConfig.OwnerUserName || '').trim()
	if (!ownerUserName || ownerUserName.toLowerCase().includes('your_')) return null

	for (const guild of client.guilds.cache.values()) 
		try {
			const members = await guild.members.fetch()
			const ownerMember = members.find(member => member.user.username === ownerUserName)
			if (ownerMember) 
				return {
					platformUserId: ownerMember.id,
					displayName: ownerMember.displayName || ownerMember.user.globalName || ownerMember.user.username,
				}
			
		}
		catch (error) {
			console.warn(`Discord owner resolve: guild ${guild.id} members.fetch failed:`, error)
		}
	

	console.warn(`Discord owner resolve: could not resolve OwnerUserName "${ownerUserName}"`)
	return null
}

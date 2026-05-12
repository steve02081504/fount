import { info_t } from './basedefs.ts'

/**
 * 用户状态类型
 */
export type UserStatus = 'online' | 'away' | 'busy' | 'offline'

/**
 * 用户 Profile 配置接口
 */
export interface UserProfile {
	username: string
	displayName: string
	avatar?: string
	bio?: string
	email?: string
	status: UserStatus
	customStatus?: string
	preferences: {
		language: string
		theme: string
		notifications: {
			email: boolean
			push: boolean
			sound: boolean
		}
	}
	social?: {
		website?: string
		github?: string
		twitter?: string
	}
	stats: {
		joinedAt: number
		messageCount: number
		groupCount: number
		channelCount: number
	}
	privacy: {
		showEmail: boolean
		showStats: boolean
		allowDirectMessages: boolean
	}
}

/**
 * Profile API 接口
 */
export class ProfileAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		/**
		 * 获取用户资料
		 */
		getProfile?: (username: string) => Promise<UserProfile>

		/**
		 * 更新用户资料
		 */
		updateProfile?: (username: string, updates: Partial<UserProfile>) => Promise<UserProfile>

		/**
		 * 上传头像
		 */
		uploadAvatar?: (username: string, file: Buffer, filename: string) => Promise<string>

		/**
		 * 获取用户统计
		 */
		getStats?: (username: string) => Promise<UserProfile['stats']>

		/**
		 * 更新用户状态
		 */
		updateStatus?: (username: string, status: UserStatus, customStatus?: string) => Promise<void>
	}
}

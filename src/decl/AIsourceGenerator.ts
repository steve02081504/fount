import { AIsource_t } from './AIsource.ts'
import { locale_t, info_t } from './basedefs'

export class AIsourceGenerator_t {
	info: info_t

	Init: () => Promise<void>
	Load: () => Promise<void>
	Unload: () => Promise<void>
	Uninstall: () => Promise<void>

	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		AIsource: {
			GetConfigTemplate: () => Promise<any>
			GetSource: (config: any, args: { username: string, SaveConfig: () => Promise<void> }) => Promise<AIsource_t<any, any>>
		}
	}
}

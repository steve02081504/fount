import { Buffer } from 'node:buffer'

import { locale_t, info_t } from './basedefs.ts'

export class importHandlerAPI_t {
	info: info_t
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init?: () => Promise<void>
	// calls on every char start, pop a message if fail
	Load?: () => Promise<void>
	// calls on every char unload
	Unload?: (reason: string) => Promise<void>
	// calls on char uninstall
	Uninstall?: (reason: string, from: string) => Promise<void>

	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		import: {
			ImportAsData: (username: string, chardata: Buffer) => Promise<Array<{ parttype: string; partname: string }>>;
			ImportByText: (username: string, text: string) => Promise<Array<{ parttype: string; partname: string }>>;
		}
	}
}

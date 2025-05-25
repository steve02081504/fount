import { locale_t, info_t } from "./basedefs";
import { Router } from 'npm:websocket-express'

// no idea but it's necessary now
export class shellAPI_t {
	info: info_t;
	Init: () => Promise<void>;
	Load: (args: { router: Router }) => Promise<void>;
	Unload: (args: { router: Router }) => Promise<void>;
	Uninstall: (reason: string, from: string) => Promise<void>;

	interfaces: {
		info?: {
			UpdateInfo: (locales: locale_t[]) => Promise<info_t>,
		},
		config?: {
			GetData: () => Promise<any>
			SetData: (data: any) => Promise<void>
		},
		invokes?: {
			ArgumentsHandler?: (user: string, args: string[]) => Promise<void>;
			IPCInvokeHandler?: (user: string, data: any) => Promise<any>;
		}
	}
}

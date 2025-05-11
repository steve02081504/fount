import { locale_t, info_t } from "./basedefs";
import { Express } from "express";

// no idea but it's necessary now
export class shellAPI_t {
	info: info_t | (locales: locale_t[]) => Promise<info_t>;
	Init: () => Promise<void>;
	Load: (app: Express) => Promise<void>;
	Unload: (app: Express) => Promise<void>;
	Uninstall: (reason: string, from: string) => Promise<void>;
	ArgumentsHandler: (user: string, args: string[]) => Promise<void>;
}

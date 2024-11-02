import { locale_t } from "./basedefs";
import { Express } from "express";

// no idea but it's necessary now
export class shellAPI_t {
	info: Record<locale_t, {
		name: string;
		avatar: string;
		description: string;
		description_markdown: string;
		version: string;
		author: string;
		homepage: string;
		issuepage: string;
		tags: string[];
	}>;
	Init: () => Promise<void>;
	Load: (app: Express) => Promise<void>;
	Unload: (app: Express) => Promise<void>;
	Uninstall: (reason: string, from: string) => Promise<void>;
	ArgumentsHandler: (user: string, args: string[]) => Promise<void>;
}

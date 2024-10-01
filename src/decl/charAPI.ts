import { timeStamp_t } from './basedefs.ts';
import { Shell_t } from './shellAPI.ts';
import { AIsource_t } from './AIsource.ts';

export class charState_t {
	InitCount: number;
	StartCount: number;
	LastStart: timeStamp_t;
	memorys: {
		extension: {};
	};
}

export class charAPI_t {
	name: string;
	avatar: string;
	description: string;
	description_markdown: string;
	version: string;
	author: string;
	homepage: string;
	tags: string[];
	// calls only on char install, and if fail, all file under this char's folder will be deleted
	Init: (stat: charState_t) => {
		success: boolean;
		message: string;
	};
	// calls on every char start, pop a message if fail
	Load: (stat: charState_t) => {
		success: boolean;
		message: string;
	};
	// calls on every char unload
	Unload: (reason: string) => void;
	// calls on char uninstall
	Uninstall: (reason: string, from: string) => void;

	// set the source of the AI so that char can use it by `source.Call(prompt)`
	// the type is for extensibility. maybe youll use an API for sfw and an other API for nsfw, idc.
	SetAISource: (source: AIsource_t<any, any>, type: string) => void;
	GetAISource: (type: string) => AIsource_t<any, any>;
	AISourceTypes: string[];

	// interface with shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	interfacies: Record<string, any>;
}

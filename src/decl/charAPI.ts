import { timeStamp_t } from './basedefs.ts';
import { Shell_t } from './shellAPI.ts';
import { AIsource_t } from './AIsource.ts';

class charState_t {
	InitCount: number;
	StartCount: number;
	LastStart: timeStamp_t;
	memorys: {
		extension: {};
	};
}

type EventType_t = 'chat'// maybe others in the future
type EventData<T extends EventType_t> = {}
type EventResponse<T extends EventType_t> = {}
export class charAPI_t {
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
	SetAISource: (source: AIsource_t, type: string) => void;

	// send an event form a shell (maybe chat WebUI or cute Live2d or a kill machine, i don't care)
	// => char process it and return a response
	// => shell process response and act with user some fucking how.
	Request: (from: Shell_t, type: EventType_t, Data: EventData<EventType_t>) => EventResponse<EventType_t>;
}

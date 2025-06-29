import ansiEscapes from 'npm:ansi-escapes@6.2.0';

class CustomConsole {
    #loggedFreshLineId = null;
    options = {
        supportsAnsi: true
    };
    _stdout = Deno.stdout;

    constructor(options) {
        this.options = { ...this.options,
            ...options
        };
    }

    log(...args) {
        console.log(...args);
    }

    error(...args) {
        console.error(...args);
    }

    freshLine(id, ...args) {
        if (this.options.supportsAnsi && this.#loggedFreshLineId === id) {
            this._stdout.write(new TextEncoder().encode(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine));
        }

        this.log(...args);
        this.#loggedFreshLineId = id;
    }
}

export const customConsole = new CustomConsole();
/* @flow */

// avoids a bug in flowtype: https://github.com/facebook/flow/issues/545

import {EventEmitter as EventEmitterOut} from 'events';

export class EventEmitter extends EventEmitterOut {
    name: string;
    constructor(name: string) {
        super();
        this.name = name;
    }
    emit(event: string, ...args:Array<any>): boolean {
        if (this.name != null) {
            console.log('[trezor.js event ' + this.name + '] ' + event + ' : ', ...args);
        }
        return super.emit(event, ...args);
    }
}

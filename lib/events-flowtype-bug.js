/* @flow */
import {EventEmitter as EventEmitterOut} from 'events';
export class EventEmitter extends EventEmitterOut {
    constructor() {
        super();
    }

    // FOR DEBUGGING
    // emit(...args: any): any {
    //     console.debug('EMITTING ', ...args, new Error('..'));
    //     return super.emit(...args);
    // }
}

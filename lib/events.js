/* @flow */

// avoids a bug in flowtype: https://github.com/facebook/flow/issues/545

import {EventEmitter as EventEmitterOut} from 'events';

export class EventEmitter extends EventEmitterOut {
    constructor() {
        super();
    }
}

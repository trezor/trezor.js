

// Simple wrapper for typechecking events
// see: https://github.com/runn1ng/flow-events
'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var events = require('events');
var EventEmitter = events.EventEmitter;

var Event0 = exports.Event0 = function () {
    function Event0(type, parent) {
        _classCallCheck(this, Event0);

        this.type = type;
        this.parent = parent;
    }

    _createClass(Event0, [{
        key: 'on',
        value: function on(listener) {
            this.parent.on(this.type, listener);
        }
    }, {
        key: 'once',
        value: function once(listener) {
            this.parent.once(this.type, listener);
        }
    }, {
        key: 'removeListener',
        value: function removeListener(listener) {
            this.parent.removeListener(this.type, listener);
        }
    }, {
        key: 'removeAllListeners',
        value: function removeAllListeners() {
            this.parent.removeAllListeners(this.type);
        }
    }, {
        key: 'emit',
        value: function emit() {
            return this.parent.emit(this.type);
        }
    }, {
        key: 'listenerCount',
        value: function listenerCount() {
            return this.parent.listenerCount(this.type);
        }
    }]);

    return Event0;
}();

var Event1 = exports.Event1 = function () {
    function Event1(type, parent) {
        _classCallCheck(this, Event1);

        this.type = type;
        this.parent = parent;
    }

    _createClass(Event1, [{
        key: 'on',
        value: function on(listener) {
            this.parent.on(this.type, listener);
        }
    }, {
        key: 'once',
        value: function once(listener) {
            this.parent.once(this.type, listener);
        }
    }, {
        key: 'removeListener',
        value: function removeListener(listener) {
            this.parent.removeListener(this.type, listener);
        }
    }, {
        key: 'removeAllListeners',
        value: function removeAllListeners() {
            this.parent.removeAllListeners(this.type);
        }
    }, {
        key: 'emit',
        value: function emit(arg1) {
            return this.parent.emit(this.type, arg1);
        }
    }, {
        key: 'listenerCount',
        value: function listenerCount() {
            return this.parent.listenerCount(this.type);
        }
    }]);

    return Event1;
}();

var Event2 = exports.Event2 = function () {
    function Event2(type, parent) {
        _classCallCheck(this, Event2);

        this.type = type;
        this.parent = parent;
    }

    _createClass(Event2, [{
        key: 'on',
        value: function on(listener) {
            this.parent.on(this.type, listener);
        }
    }, {
        key: 'once',
        value: function once(listener) {
            this.parent.once(this.type, listener);
        }
    }, {
        key: 'removeListener',
        value: function removeListener(listener) {
            this.parent.removeListener(this.type, listener);
        }
    }, {
        key: 'removeAllListeners',
        value: function removeAllListeners() {
            this.parent.removeAllListeners(this.type);
        }
    }, {
        key: 'emit',
        value: function emit(arg1, arg2) {
            return this.parent.emit(this.type, arg1, arg2);
        }
    }, {
        key: 'listenerCount',
        value: function listenerCount() {
            return this.parent.listenerCount(this.type);
        }
    }]);

    return Event2;
}();
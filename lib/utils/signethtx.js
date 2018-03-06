'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

exports.signEthTx = signEthTx;

var _trezortypes = require('../trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function splitString(str, len) {
    if (str == null) {
        return ['', ''];
    }
    var first = str.slice(0, len);
    var second = str.slice(len);
    return [first, second];
}

function processTxRequest(session, request, data) {
    if (!request.data_length) {
        var _v = request.signature_v;
        var _r = request.signature_r;
        var _s = request.signature_s;
        if (_v == null || _r == null || _s == null) {
            throw new Error('Unexpected request.');
        }

        return Promise.resolve({
            v: _v, r: _r, s: _s
        });
    }

    var _splitString = splitString(data, request.data_length * 2),
        _splitString2 = _slicedToArray(_splitString, 2),
        first = _splitString2[0],
        rest = _splitString2[1];

    return session.typedCall('EthereumTxAck', 'EthereumTxRequest', { data_chunk: first }).then(function (response) {
        return processTxRequest(session, response.message, rest);
    });
}

function stripLeadingZeroes(str) {
    while (/^00/.test(str)) {
        str = str.slice(2);
    }
    return str;
}

function signEthTx(session, address_n, nonce, gas_price, gas_limit, to, value, data, chain_id) {
    var length = data == null ? 0 : data.length / 2;

    var _splitString3 = splitString(data, 1024 * 2),
        _splitString4 = _slicedToArray(_splitString3, 2),
        first = _splitString4[0],
        rest = _splitString4[1];

    var message = {
        address_n: address_n,
        nonce: stripLeadingZeroes(nonce),
        gas_price: stripLeadingZeroes(gas_price),
        gas_limit: stripLeadingZeroes(gas_limit),
        to: to,
        value: stripLeadingZeroes(value)
    };

    if (length !== 0) {
        message = _extends({}, message, {
            data_length: length,
            data_initial_chunk: first
        });
    }

    if (chain_id != null) {
        message = _extends({}, message, {
            chain_id: chain_id
        });
    }

    return session.typedCall('EthereumSignTx', 'EthereumTxRequest', message).then(function (res) {
        return processTxRequest(session, res.message, rest);
    });
}
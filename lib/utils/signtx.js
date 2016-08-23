'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.signTx = signTx;

var _trezortypes = require('../trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function indexTxsForSign(txs) {
    const index = {};
    txs.forEach(tx => {
        index[tx.hash.toLowerCase()] = tx;
    });
    return index;
}

// requests information about a transaction
// can be either signed transaction iteslf of prev transaction
function requestTxInfo(m, index, inputs, outputs) {
    const md = m.details;
    const hash = md.tx_hash;
    if (hash) {
        const reqTx = index[hash.toLowerCase()];
        if (!reqTx) {
            throw new Error(`Requested unknown tx: ${ hash }`);
        }
        return requestPrevTxInfo(reqTx, m.request_type, md.request_index);
    } else {
        return requestSignedTxInfo(inputs, outputs, m.request_type, md.request_index);
    }
}

function requestPrevTxInfo(reqTx, requestType, requestIndex) {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return { inputs: [reqTx.inputs[i]] };
    }
    if (requestType === 'TXOUTPUT') {
        return { bin_outputs: [reqTx.bin_outputs[i]] };
    }
    if (requestType === 'TXMETA') {
        const outputCount = reqTx.bin_outputs.length;
        return {
            version: reqTx.version,
            lock_time: reqTx.lock_time,
            inputs_cnt: reqTx.inputs.length,
            outputs_cnt: outputCount
        };
    }
    throw new Error(`Unknown request type: ${ requestType }`);
}

function requestSignedTxInfo(inputs, outputs, requestType, requestIndex) {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return { inputs: [inputs[i]] };
    }
    if (requestType === 'TXOUTPUT') {
        return { outputs: [outputs[i]] };
    }
    if (requestType === 'TXMETA') {
        throw new Error('Cannot read TXMETA from signed transaction');
    }
    throw new Error(`Unknown request type: ${ requestType }`);
}

function saveTxSignatures(ms, serializedTx, signatures) {
    if (ms) {
        const _signatureIndex = ms.signature_index;
        const _signature = ms.signature;
        const _serializedTx = ms.serialized_tx;
        if (_serializedTx != null) {
            serializedTx.serialized += _serializedTx;
        }
        if (_signatureIndex != null) {
            if (_signature == null) {
                throw new Error('Unexpected null in trezor.TxRequestSerialized signature.');
            }
            signatures[_signatureIndex] = _signature;
        }
    }
}

function processTxRequest(session, m, serializedTx, signatures, index, ins, outs) {
    saveTxSignatures(m.serialized, serializedTx, signatures);

    if (m.request_type === 'TXFINISHED') {
        return Promise.resolve({
            message: {
                serialized: {
                    signatures: signatures,
                    serialized_tx: serializedTx.serialized
                }
            },
            type: 'trezor.SignedTx'
        });
    }

    const resTx = requestTxInfo(m, index, ins, outs);

    return session.typedCall('TxAck', 'TxRequest', { tx: resTx }).then(response => processTxRequest(session, response.message, serializedTx, signatures, index, ins, outs));
}

function signTx(session, inputs, outputs, txs, coin) {
    const index = indexTxsForSign(txs);
    const signatures = [];
    const serializedTx = { serialized: '' };

    const coinName = typeof coin === 'string' ? coin : coin.coin_name;
    const coinNameCapitalized = coinName.charAt(0).toUpperCase() + coinName.slice(1);

    return session.typedCall('SignTx', 'TxRequest', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coinNameCapitalized
    }).then(res => processTxRequest(session, res.message, serializedTx, signatures, index, inputs, outputs));
}
/* @flow */
'use strict';

import * as trezortypes from '../trezortypes';

import type Session, {MessageResponse} from '../session';

function indexTxsForSign(
    txs: Array<trezortypes.RefTransaction>
): {[key: string]: trezortypes.RefTransaction} {
    const index = {};

    // Referenced txs
    txs.forEach(tx => {
        index[tx.hash.toLowerCase()] = tx;
    });

    return index;
}

// requests information about a transaction
// can be either signed transaction iteslf of prev transaction
function requestTxInfo(
    m: trezortypes.TxRequest,
    index: {[key: string]: trezortypes.RefTransaction},
    inputs: Array<trezortypes.TransactionInput>,
    outputs: Array<trezortypes.TransactionOutput>
): trezortypes.SignTxInfoToTrezor {
    const md = m.details;
    if (md.tx_hash) {
        const reqTx: ?trezortypes.RefTransaction = index[(md.tx_hash).toLowerCase()];
        if (!reqTx) {
            throw new Error((`Requested unknown tx: ${md.tx_hash}`));
        }
        return requestPrevTxInfo(
            reqTx,
            m.request_type,
            md.request_index
        );
    } else {
        return requestSignedTxInfo(inputs, outputs, m.request_type, md.request_index);
    }
}

function requestPrevTxInfo(
    reqTx: trezortypes.RefTransaction,
    requestType: string,
    requestIndex: string | number
): trezortypes.SignTxInfoToTrezor {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return {inputs: [reqTx.inputs[i]]};
    }
    if (requestType === 'TXOUTPUT') {
        return {bin_outputs: [reqTx.bin_outputs[i]]};
    }
    if (requestType === 'TXMETA') {
        const outputCount = reqTx.bin_outputs.length;
        return {
            version: reqTx.version,
            lock_time: reqTx.lock_time,
            inputs_cnt: reqTx.inputs.length,
            outputs_cnt: outputCount,
        };
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function requestSignedTxInfo(
    inputs: Array<trezortypes.TransactionInput>,
    outputs: Array<trezortypes.TransactionOutput>,
    requestType: string,
    requestIndex: string | number
): trezortypes.SignTxInfoToTrezor {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return {inputs: [inputs[i]]};
    }
    if (requestType === 'TXOUTPUT') {
        return {outputs: [outputs[i]]};
    }
    if (requestType === 'TXMETA') {
        throw new Error('Cannot read TXMETA from signed transaction');
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function saveTxSignatures(
    ms: trezortypes.TxRequestSerialized,
    serializedTx: {serialized: string},
    signatures: Array<string>
) {
    if (ms) {
        const _signatureIndex: ?number = ms.signature_index;
        const _signature: ?string = ms.signature;
        const _serializedTx: ?string = ms.serialized_tx;
        if (_serializedTx != null) {
            serializedTx.serialized += _serializedTx;
        }
        if (_signatureIndex != null) {
            if (_signature == null) {
                throw new Error('Unexpected null in trezortypes.TxRequestSerialized signature.');
            }
            signatures[_signatureIndex] = _signature;
        }
    }
}

function processTxRequest(
    session: Session,
    m: trezortypes.TxRequest,
    serializedTx: {serialized: string},
    signatures: Array<string>,
    index: {[key: string]: trezortypes.RefTransaction},
    ins: Array<trezortypes.TransactionInput>,
    outs: Array<trezortypes.TransactionOutput>
): Promise<MessageResponse<trezortypes.SignedTx>> {
    saveTxSignatures(m.serialized, serializedTx, signatures);

    if (m.request_type === 'TXFINISHED') {
        return Promise.resolve({
            message: {
                serialized: {
                    signatures: signatures,
                    serialized_tx: serializedTx.serialized,
                },
            },
            type: 'trezortypes.SignedTx',
        });
    }

    const resTx = requestTxInfo(m, index, ins, outs);
    return session.typedCall('TxAck', 'TxRequest', {
        tx: resTx,
    }).then(response => processTxRequest(session, response.message, serializedTx, signatures, index, ins, outs));
}

export function signTx(
    session: Session,
    inputs: Array<trezortypes.TransactionInput>,
    outputs: Array<trezortypes.TransactionOutput>,
    txs: Array<trezortypes.RefTransaction>,
    coin: trezortypes.CoinType | string
): Promise<MessageResponse<trezortypes.SignedTx>> {
    const index: {[key: string]: trezortypes.RefTransaction} = indexTxsForSign(txs);
    const signatures: Array<string> = [];
    const serializedTx: {serialized: string} = {serialized: ''};

    const coinName = (typeof coin === 'string') ? coin : coin.coin_name;
    const coinNameCapitalized = coinName.charAt(0).toUpperCase() + coinName.slice(1);
    return session.typedCall('SignTx', 'TxRequest', {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coinNameCapitalized,
    }).then((res) =>
        processTxRequest(session, res.message, serializedTx, signatures, index, inputs, outputs)
    );
}

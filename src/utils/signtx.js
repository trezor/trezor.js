/* @flow */
'use strict';

import * as trezor from '../trezortypes';

import type Session, {MessageResponse} from '../session';

function indexTxsForSign(
    txs: Array<trezor.RefTransaction>
): {[hash: string]: trezor.RefTransaction} {
    const index = {};
    txs.forEach(tx => {
        index[tx.hash.toLowerCase()] = tx;
    });
    return index;
}

// requests information about a transaction
// can be either signed transaction iteslf of prev transaction
function requestTxInfo(
    m: trezor.TxRequest,
    index: {[hash: string]: trezor.RefTransaction},
    inputs: Array<trezor.TransactionInput>,
    outputs: Array<trezor.TransactionOutput>
): trezor.SignTxInfoToTrezor {
    const md = m.details;
    const hash = md.tx_hash;
    if (hash) {
        const reqTx = index[hash.toLowerCase()];
        if (!reqTx) {
            throw new Error(`Requested unknown tx: ${hash}`);
        }
        return requestPrevTxInfo(
            reqTx,
            m.request_type,
            md.request_index,
            md.extra_data_len,
            md.extra_data_offset
        );
    } else {
        return requestSignedTxInfo(inputs, outputs, m.request_type, md.request_index);
    }
}

function requestPrevTxInfo(
    reqTx: trezor.RefTransaction,
    requestType: string,
    requestIndex: string | number,
    dataLen: ?(string | number),
    dataOffset: ?(string | number),
): trezor.SignTxInfoToTrezor {
    const i = +requestIndex;
    if (requestType === 'TXINPUT') {
        return {inputs: [reqTx.inputs[i]]};
    }
    if (requestType === 'TXOUTPUT') {
        return {bin_outputs: [reqTx.bin_outputs[i]]};
    }
    if (requestType === 'TXEXTRADATA') {
        if (dataLen == null) {
            throw new Error('Missing extra_data_len');
        }
        const dataLenN: number = +dataLen;

        if (dataOffset == null) {
            throw new Error('Missing extra_data_offset');
        }
        const dataOffsetN: number = +dataOffset;

        if (reqTx.extra_data == null) {
            throw new Error('No extra data for transaction ' + reqTx.hash);
        }

        const data: string = reqTx.extra_data;
        const substring = data.substring(dataOffsetN * 2, (dataOffsetN + dataLenN) * 2);
        return {extra_data: substring};
    }
    if (requestType === 'TXMETA') {
        const outputCount = reqTx.bin_outputs.length;
        const data: ?string = reqTx.extra_data;
        if (data != null && data.length !== 0) {
            const data_: string = data;
            return {
                version: reqTx.version,
                lock_time: reqTx.lock_time,
                inputs_cnt: reqTx.inputs.length,
                outputs_cnt: outputCount,
                extra_data_len: data_.length / 2,
                version_group_id: reqTx.version_group_id,
            };
        } else {
            return {
                version: reqTx.version,
                lock_time: reqTx.lock_time,
                inputs_cnt: reqTx.inputs.length,
                outputs_cnt: outputCount,
                version_group_id: reqTx.version_group_id,
            };
        }
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function requestSignedTxInfo(
    inputs: Array<trezor.TransactionInput>,
    outputs: Array<trezor.TransactionOutput>,
    requestType: string,
    requestIndex: string | number
): trezor.SignTxInfoToTrezor {
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
    if (requestType === 'TXEXTRADATA') {
        throw new Error('Cannot read TXEXTRADATA from signed transaction');
    }
    throw new Error(`Unknown request type: ${requestType}`);
}

function saveTxSignatures(
    ms: trezor.TxRequestSerialized,
    serializedTx: {serialized: string},
    signatures: Array<string>
) {
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

function processTxRequest(
    session: Session,
    m: trezor.TxRequest,
    serializedTx: {serialized: string},
    signatures: Array<string>,
    index: {[key: string]: trezor.RefTransaction},
    ins: Array<trezor.TransactionInput>,
    outs: Array<trezor.TransactionOutput>
): Promise<MessageResponse<trezor.SignedTx>> {
    saveTxSignatures(m.serialized, serializedTx, signatures);

    if (m.request_type === 'TXFINISHED') {
        return Promise.resolve({
            message: {
                serialized: {
                    signatures: signatures,
                    serialized_tx: serializedTx.serialized,
                },
            },
            type: 'trezor.SignedTx',
        });
    }

    const resTx = requestTxInfo(m, index, ins, outs);

    return session.typedCall('TxAck', 'TxRequest', {tx: resTx}).then(
        (response) => processTxRequest(
            session,
            response.message,
            serializedTx,
            signatures,
            index,
            ins,
            outs
        )
    );
}

export function signTx(
    session: Session,
    inputs: Array<trezor.TransactionInput>,
    outputs: Array<trezor.TransactionOutput>,
    txs: Array<trezor.RefTransaction>,
    coin: string,
    locktime: ?number,
    overwintered: ?boolean,
): Promise<MessageResponse<trezor.SignedTx>> {
    const index = indexTxsForSign(txs);
    const signatures = [];
    const serializedTx = {serialized: ''};

    const coinName = (typeof coin === 'string') ? coin : coin.coin_name;
    const coinNameCapitalized = coinName.charAt(0).toUpperCase() + coinName.slice(1);

    let txDesc = {
        inputs_count: inputs.length,
        outputs_count: outputs.length,
        coin_name: coinNameCapitalized,
        lock_time: locktime,
    };

    // this is done like that, so old devices work on non-zcash txs
    if (overwintered) {
        txDesc = {
            ...txDesc,
            overwintered: true,
            version: 4,
            version_group_id: 0x892f2085,
            branch_id: 0x2bb40e60,
        };
    }

    return session.typedCall('SignTx', 'TxRequest', txDesc).then((res) =>
        processTxRequest(session, res.message, serializedTx, signatures, index, inputs, outputs)
    );
}

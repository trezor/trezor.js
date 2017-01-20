/* @flow */
'use strict';

import * as trezor from '../trezortypes';

import type Session from '../session';

export type EthereumSignature = {
  v: number,
  r: string,
  s: string,
};

function splitString(str: ?string, len: number): [string, string] {
    if (str == null) {
        return ['', ''];
    }
    const first = str.slice(0, len);
    const second = str.slice(len);
    return [first, second];
}

function processTxRequest(
    session: Session,
    request: trezor.EthereumTxRequest,
    data: ?string
): Promise<EthereumSignature> {
    if (!request.data_length) {
        const v = request.signature_v;
        const r = request.signature_r;
        const s = request.signature_s;
        if (v == null || r == null || s == null) {
            throw new Error('Unexpected request.');
        }

        return Promise.resolve({
            v, r, s,
        });
    }

    const [first, rest] = splitString(data, request.data_length * 2);

    return session.typedCall('EthereumTxAck', 'EthereumTxRequest', {data_chunk: first}).then(
        (response) => processTxRequest(
            session,
            response.message,
            rest
        )
    );
}

export function signEthTx(
    session: Session,
    address_n: Array<number>,
    nonce: string,
    gas_price: string,
    gas_limit: string,
    to: string,
    value: string,
    data?: string,
): Promise<EthereumSignature> {
    const length = data == null ? 0 : data.length / 2;

    const [first, rest] = splitString(data, 1024 * 2);

    const length_or_null = length === 0 ? null : length;
    const first_or_null = length === 0 ? null : first;

    const value_zero = /^(00)*$/.test(value);
    const value_or_null = value_zero ? null : value;

    const nonce_zero = /^(00)*$/.test(nonce);
    const nonce_or_null = nonce_zero ? null : nonce;

    return session.typedCall('EthereumSignTx', 'EthereumTxRequest', {
        address_n,
        nonce_or_null,
        gas_price,
        gas_limit,
        to,
        value: value_or_null,
        data_initial_chunk: first_or_null,
        data_length: length_or_null,
    }).then((res) =>
        processTxRequest(session, res.message, rest)
    );
}

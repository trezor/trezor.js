/* @flow */
'use strict';

import * as trezor from '../trezortypes';

import type Session, {MessageResponse} from '../session';

export type LiskSignature = {
    signature: string;
}

type PreparedLiskTransaction = trezor.LiskTransaction & {
    recipient_id?: string;
    sender_public_key?: Buffer;
    requester_public_key?: Buffer;
}

const snakefy = (val: string): string => val.replace(/([A-Z])/g, el => '_' + el.toLowerCase());

const toSnake = (val, obj, formater) => {
    const newName = snakefy(val);
    obj[newName] = formater ? formater(obj[val]) : obj[val];
    delete obj[val];
};

const unhexlify = (val: string) => new Buffer(val, 'hex');

const checkField = (obj: Object) => (val: string): boolean => obj.hasOwnProperty(val);

const prepareTxAsset = (data: trezor.LiskAsset) => {
    // got a mess with all this nested union types while converting cameCase to snakeCase name
    // pick any only for this
    const asset: any = Object.assign(data);
    if (asset.signature) {
        asset.signature.public_key = unhexlify(asset.signature.publicKey);
        delete asset.signature.publicKey;
    }
    if (asset.multisignature) {
        asset.multisignature.life_time = asset.multisignature.lifetime;
        delete asset.multisignature.lifetime;
        asset.multisignature.keys_group = asset.multisignature.keysgroup;
        delete asset.multisignature.keysgroup;
    }
};

const prepareTx = (tx: trezor.LiskTransaction): PreparedLiskTransaction => {
    const transaction: PreparedLiskTransaction = Object.assign({}, tx);
    const isFieldExist = checkField(transaction);

    transaction.amount = parseInt(transaction.amount, 10);
    transaction.fee = parseInt(transaction.fee, 10);

    if (isFieldExist('recipientId')) toSnake('recipientId', transaction);
    if (isFieldExist('senderPublicKey')) toSnake('senderPublicKey', transaction, unhexlify);
    if (isFieldExist('requesterPublicKey')) toSnake('requesterPublicKey', transaction, unhexlify);
    if (isFieldExist('signature')) transaction.signature = unhexlify(transaction.signature);

    prepareTxAsset(transaction.asset);

    return transaction;
};

export function signLiskTx(
    session: Session,
    address_n: Array<number>,
    transaction: trezor.LiskTransaction
): Promise<MessageResponse<LiskSignature>> {
    const message = {
        address_n,
        transaction: prepareTx(transaction),
    };

    return session.typedCall('LiskSignTx', 'LiskSignedTx', message);
}

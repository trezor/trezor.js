/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as ecurve from 'ecurve';
import * as trezortypes from '../trezortypes';

import type Session, {MessageResponse} from '../session';

// Converts from bitcoin.js HDNode to Trezor's own structure
export function bjsNode2privNode(node: bitcoin.HDNode): trezortypes.HDPrivNode {
    const d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    const depth = node.depth;
    const fingerprint = node.parentFingerprint;
    const child_num = node.index;
    const private_key = d.toString('hex');
    const chain_code = node.chainCode.toString('hex');
    return {depth, fingerprint, child_num, chain_code, private_key};
}

export function pubNode2bjsNode(
    node: trezortypes.HDPubNode,
    network: bitcoin.Network
): bitcoin.HDNode {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    const Q = ecurve.Point.decodeFrom(ecurve.getCurveByName('secp256k1'), publicKey);
    const res = new bitcoin.HDNode(new bitcoin.ECPair(null, Q, network), chainCode);

    res.depth = +node.depth;
    res.index = +node.child_num;
    res.parentFingerprint = node.fingerprint;

    return res;
}

// converts from internal PublicKey format to bitcoin.js HDNode
// network info is necessary
// throws error on wrong xpub
export function pubKey2bjsNode(
    key: MessageResponse<trezortypes.PublicKey>,
    network: bitcoin.Network
): bitcoin.HDNode {
    const keyNode: trezortypes.HDPubNode = key.message.node;
    const bjsNode: bitcoin.HDNode = pubNode2bjsNode(keyNode, network);

    const bjsXpub: string = bjsNode.toBase58();
    const keyXpub: string = key.message.xpub;

    if (bjsXpub !== keyXpub) {
        throw new Error('Invalid public key transmission detected - ' +
                    'invalid xpub check. ' +
                    'Key: ' + bjsXpub + ', ' +
                    'Received: ' + keyXpub);
    }

    return bjsNode;
}

export function checkDerivation(
    parBjsNode: bitcoin.HDNode,
    childBjsNode: bitcoin.HDNode,
    suffix: number
): void {
    const derivedChildBjsNode = parBjsNode.derive(suffix);

    const derivedXpub = derivedChildBjsNode.toBase58();
    const compXpub = childBjsNode.toBase58();

    if (derivedXpub !== compXpub) {
        throw new Error('Invalid public key transmission detected - ' +
                    'invalid child cross-check. ' +
                    'Computed derived: ' + derivedXpub + ', ' +
                    'Computed received: ' + compXpub);
    }
}

export function derivePubKeyHash(
    nodes: Array<bitcoin.HDNode>,
    nodeIx: number,
    addressIx: number
): Buffer {
    const node = nodes[nodeIx].derive(addressIx);
    const pkh: Buffer = node.getIdentifier();
    return pkh;
}

export function getHDNode(
    session: Session,
    path: Array<number>,
    network_: ?bitcoin.Network
): Promise<bitcoin.HDNode> {
    const suffix = 0;
    const childPath: Array<number> = path.concat([suffix]);
    const network: bitcoin.Network = network_ == null ? bitcoin.networks.bitcoin : network_;

    return session.getPublicKey(path).then((resKey: MessageResponse<trezortypes.PublicKey>) => {
        const resNode: bitcoin.HDNode = pubKey2bjsNode(resKey, network);

        return session.getPublicKey(childPath).then((childKey: MessageResponse<trezortypes.PublicKey>) => {
            const childNode: bitcoin.HDNode = pubKey2bjsNode(childKey, network);
            checkDerivation(resNode, childNode, suffix);
            return resNode;
        });
    });
}


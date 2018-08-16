/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-trezor';
import * as trezor from '../trezortypes';

import type Session, {MessageResponse} from '../session';

export function pubNode2bjsNode(
    node: trezor.HDPubNode,
    network: bitcoin.Network
): bitcoin.HDNode {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    const res = bitcoin.HDNode.fromInternal(chainCode, publicKey, network, +node.depth, +node.child_num, node.fingerprint);

    return res;
}

// stupid hack, because trezor serializes all xpubs with bitcoin magic
function convertXpub(original: string, network: bitcoin.Network) {
    if (network.bip32.public === 0x0488b21e) {
        // it's bitcoin-like => return xpub
        return original;
    } else {
        const node = bitcoin.HDNode.fromBase58(original); // use bitcoin magic

        // "hard-fix" the new network into the HDNode keypair
        node.setNetwork(network);
        return node.toBase58();
    }
}

// converts from internal PublicKey format to bitcoin.js HDNode
// network info is necessary. throws error on wrong xpub
export function pubKey2bjsNode(
    key: MessageResponse<trezor.PublicKey>,
    network: bitcoin.Network
): bitcoin.HDNode {
    const keyNode: trezor.HDPubNode = key.message.node;
    const bjsNode: bitcoin.HDNode = pubNode2bjsNode(keyNode, network);

    const bjsXpub: string = bjsNode.toBase58();
    const keyXpub: string = convertXpub(key.message.xpub, network);

    if (bjsXpub !== keyXpub) {
        throw new Error('Invalid public key transmission detected - ' +
                    'invalid xpub check. ' +
                    'Key: ' + bjsXpub + ', ' +
                    'Received: ' + keyXpub);
    }

    return bjsNode;
}

/* export function checkDerivation(
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
}*/

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
    network: bitcoin.Network,
    xpubDerive: (xpub: string, network: bitcoin.Network, index: number) => Promise<string>,
): Promise<bitcoin.HDNode> {
    const suffix = 0;
    const childPath = path.concat([suffix]);

    return session._getPublicKeyInternal(path).then((resKey: MessageResponse<trezor.PublicKey>) => {
        const resNode = pubKey2bjsNode(resKey, network);
        const resXpub = resKey.message.xpub;

        return session._getPublicKeyInternal(childPath).then((childKey: MessageResponse<trezor.PublicKey>) => {
            // const childNode = pubKey2bjsNode(childKey, network);
            const childXpub = childKey.message.xpub;
            return xpubDerive(resXpub, bitcoin.networks.bitcoin, suffix).then(actualChildXpub => {
                if (actualChildXpub !== childXpub) {
                    throw new Error('Invalid public key transmission detected - ' +
                        'invalid child cross-check. ' +
                        'Computed derived: ' + actualChildXpub + ', ' +
                        'Computed received: ' + childXpub);
                }
                return resNode;
            });
        });
    });
}

const HARDENING = 0x80000000;

export function harden(number: number): number {
    return (number | HARDENING) >>> 0;
}

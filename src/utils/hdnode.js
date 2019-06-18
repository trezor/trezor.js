/* @flow */
'use strict';

import * as bitcoin from '@trezor/utxo-lib';
import * as ecurve from 'ecurve';
import * as trezor from '../trezortypes';

import type Session, {MessageResponse} from '../session';

const curve = ecurve.getCurveByName('secp256k1');

// simplified CoinInfo object passed from mytrezor
export type CoinInfo = {
    network: typeof bitcoin.networks.bitcoin;
    name: string;
    segwitPubMagic: ?number;
}

export const BITCOIN_COIN_INFO: CoinInfo = {
    name: 'Bitcoin',
    network: bitcoin.networks.bitcoin,
    segwitPubMagic: 77429938,
};

export function bjsNode2privNode(node: bitcoin.HDNode): trezor.HDPrivNode {
    const d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    const depth = node.depth;
    const fingerprint = node.parentFingerprint;
    const child_num = node.index;
    const private_key = d.toString(16);
    const chain_code = node.chainCode.toString('hex');
    return {depth, fingerprint, child_num, chain_code, private_key};
}

export function pubNode2bjsNode(
    node: trezor.HDPubNode,
    network: bitcoin.Network
): bitcoin.HDNode {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    if (curve == null) {
        throw new Error('secp256k1 is null');
    }
    const Q = ecurve.Point.decodeFrom(curve, publicKey);
    const res = new bitcoin.HDNode(new bitcoin.ECPair(null, Q, {network: network}), chainCode);

    res.depth = +node.depth;
    res.index = +node.child_num;
    res.parentFingerprint = node.fingerprint;

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
        node.keyPair.network = network;
        return node.toBase58();
    }
}

// converts from internal PublicKey format to bitcoin.js HDNode
// network info is necessary. throws error on wrong xpub
export function pubKey2bjsNode(
    key: MessageResponse<trezor.PublicKey>,
    network: bitcoin.Network,
    convert: boolean = true,
): bitcoin.HDNode {
    const keyNode: trezor.HDPubNode = key.message.node;
    const bjsNode: bitcoin.HDNode = pubNode2bjsNode(keyNode, network);

    const bjsXpub: string = bjsNode.toBase58();
    // const keyXpub: string = convertXpub(key.message.xpub, network);
    const keyXpub = convert ? convertXpub(key.message.xpub, network) : bitcoin.HDNode.fromBase58(key.message.xpub, network).toBase58();

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

// Proxy
// Generate xpub with or without script_type
export function getHDNode(
    session: Session,
    path: Array<number>,
    networkOrCoinInfo: bitcoin.Network | CoinInfo,
    xpubDerive: (xpub: string, network: bitcoin.Network, index: number) => Promise<string>,
): Promise<bitcoin.HDNode> {
    const device = session.device;
    const canUseScriptType = device && ((device.features.major_version === 2 && device.atLeast('2.0.10')) || (device.features.major_version === 1 && device.atLeast('1.7.2')));
    const coinInfo: any = (typeof networkOrCoinInfo.name === 'string') ? networkOrCoinInfo : null;
    if (canUseScriptType && coinInfo) {
        return getScriptTypeHDNode(session, path, coinInfo, xpubDerive);
    }
    const network: any = coinInfo ? coinInfo.network : networkOrCoinInfo;
    return getBitcoinHDNode(session, path, network, xpubDerive);
}

function getScriptType(path: Array<number>, coinInfo: CoinInfo): ?string {
    if (!Array.isArray(path) || path.length < 1) return;
    const s = (path[0] & ~0x80000000) >>> 0;
    switch (s) {
        case 44:
            return 'SPENDADDRESS';
        case 48:
            return 'SPENDMULTISIG';
        case 49:
            return coinInfo.segwitPubMagic ? 'SPENDP2SHWITNESS' : undefined;
        case 84:
            return coinInfo.segwitNativePubMagic ? 'SPENDWITNESS' : undefined;
        default:
            return;
    }
}

function getScriptTypeNetwork(scriptType: ?string, coinInfo: CoinInfo): bitcoin.Network {
    const clone = JSON.parse(JSON.stringify(coinInfo));
    if (scriptType === 'SPENDP2SHWITNESS' && coinInfo.segwitPubMagic) {
        clone.network.bip32.public = coinInfo.segwitPubMagic;
    }
    if (scriptType === 'SPENDWITNESS' && coinInfo.segwitNativePubMagic) {
        clone.network.bip32.public = coinInfo.segwitNativePubMagic;
    }
    return clone.network;
}

// calling GetPublicKey message with script_type field
// to make it work we need to have more information about network (segwitPubMagic and segwitNativePubMagic)
// that's why this method should accept CoinInfo object only, an extended coin definition from "mytrezor"
// consider to add script_type values witch segwit and bech32 magic fields to bitcoinjs-trezor lib
function getScriptTypeHDNode(
    session: Session,
    path: Array<number>,
    coinInfo: CoinInfo,
    xpubDerive: (xpub: string, network: bitcoin.Network, index: number) => Promise<string>,
): Promise<bitcoin.HDNode> {
    const suffix = 0;
    const childPath = path.concat([suffix]);
    const scriptType = getScriptType(path, coinInfo);
    const network = getScriptTypeNetwork(scriptType, coinInfo);

    return session._getPublicKeyInternal(path, coinInfo.name, scriptType).then((resKey: MessageResponse<trezor.PublicKey>) => {
        const resNode = pubKey2bjsNode(resKey, network, false);
        const resXpub = resKey.message.xpub;

        return session._getPublicKeyInternal(childPath, coinInfo.name, scriptType).then((childKey: MessageResponse<trezor.PublicKey>) => {
            // const childNode = pubKey2bjsNode(childKey, network);
            const childXpub = childKey.message.xpub;
            return xpubDerive(resXpub, network, suffix).then(actualChildXpub => {
                if (actualChildXpub !== childXpub) {
                    throw new Error('Invalid public key transmission detected - ' +
                        'invalid child cross-check. ' +
                        'Computed derived: ' + actualChildXpub + ', ' +
                        'Computed received: ' + childXpub);
                }
                // mytrezor wallet is still expecting xpubs to be in legacy format
                // network.public should be set to default (CoinInfo.xpub_magic)
                // Since network is already converted in "getScriptTypeNetwork" method xpub_magic_segwit_p2sh may be used at this point
                // set back network to default
                // it should be fixed in mytrezor to avoid unnecessary conversion back and forth
                resNode.keyPair.network = coinInfo.network;
                return resNode;
            });
        });
    });
}

// fw below 1.7.1 and 2.0.8 does not return xpubs in proper format
function getBitcoinHDNode(
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

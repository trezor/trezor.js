'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.bjsNode2privNode = bjsNode2privNode;
exports.pubNode2bjsNode = pubNode2bjsNode;
exports.pubKey2bjsNode = pubKey2bjsNode;
exports.checkDerivation = checkDerivation;
exports.derivePubKeyHash = derivePubKeyHash;
exports.getHDNode = getHDNode;

var _bitcoinjsLib = require('bitcoinjs-lib');

var bitcoin = _interopRequireWildcard(_bitcoinjsLib);

var _ecurve = require('ecurve');

var ecurve = _interopRequireWildcard(_ecurve);

var _trezortypes = require('../trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

const curve = ecurve.getCurveByName('secp256k1');

function bjsNode2privNode(node) {
    const d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    const depth = node.depth;
    const fingerprint = node.parentFingerprint;
    const child_num = node.index;
    const private_key = d.toString(16);
    const chain_code = node.chainCode.toString('hex');
    return { depth: depth, fingerprint: fingerprint, child_num: child_num, chain_code: chain_code, private_key: private_key };
}

function pubNode2bjsNode(node, network) {
    const chainCode = new Buffer(node.chain_code, 'hex');
    const publicKey = new Buffer(node.public_key, 'hex');

    if (curve == null) {
        throw new Error('secp256k1 is null');
    }
    const Q = ecurve.Point.decodeFrom(curve, publicKey);
    const res = new bitcoin.HDNode(new bitcoin.ECPair(null, Q, { network: network }), chainCode);

    res.depth = +node.depth;
    res.index = +node.child_num;
    res.parentFingerprint = node.fingerprint;

    return res;
}

// stupid hack, because trezor serializes all xpubs with bitcoin magic
function convertXpub(original, network) {
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
function pubKey2bjsNode(key, network) {
    const keyNode = key.message.node;
    const bjsNode = pubNode2bjsNode(keyNode, network);

    const bjsXpub = bjsNode.toBase58();
    const keyXpub = convertXpub(key.message.xpub, network);

    if (bjsXpub !== keyXpub) {
        throw new Error('Invalid public key transmission detected - ' + 'invalid xpub check. ' + 'Key: ' + bjsXpub + ', ' + 'Received: ' + keyXpub);
    }

    return bjsNode;
}

function checkDerivation(parBjsNode, childBjsNode, suffix) {
    const derivedChildBjsNode = parBjsNode.derive(suffix);

    const derivedXpub = derivedChildBjsNode.toBase58();
    const compXpub = childBjsNode.toBase58();

    if (derivedXpub !== compXpub) {
        throw new Error('Invalid public key transmission detected - ' + 'invalid child cross-check. ' + 'Computed derived: ' + derivedXpub + ', ' + 'Computed received: ' + compXpub);
    }
}

function derivePubKeyHash(nodes, nodeIx, addressIx) {
    const node = nodes[nodeIx].derive(addressIx);
    const pkh = node.getIdentifier();
    return pkh;
}

function getHDNode(session, path) {
    let network = arguments.length <= 2 || arguments[2] === undefined ? bitcoin.networks.bitcoin : arguments[2];

    const suffix = 0;
    const childPath = path.concat([suffix]);

    return session.getPublicKey(path).then(resKey => {
        const resNode = pubKey2bjsNode(resKey, network);

        return session.getPublicKey(childPath).then(childKey => {
            const childNode = pubKey2bjsNode(childKey, network);

            checkDerivation(resNode, childNode, suffix);
            return resNode;
        });
    });
}
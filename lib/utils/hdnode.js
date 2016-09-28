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

var curve = ecurve.getCurveByName('secp256k1');

function bjsNode2privNode(node) {
    var d = node.keyPair.d;
    if (!d) {
        throw new Error('Not a private node.');
    }
    var depth = node.depth;
    var fingerprint = node.parentFingerprint;
    var child_num = node.index;
    var private_key = d.toString(16);
    var chain_code = node.chainCode.toString('hex');
    return { depth: depth, fingerprint: fingerprint, child_num: child_num, chain_code: chain_code, private_key: private_key };
}

function pubNode2bjsNode(node, network) {
    var chainCode = new Buffer(node.chain_code, 'hex');
    var publicKey = new Buffer(node.public_key, 'hex');

    if (curve == null) {
        throw new Error('secp256k1 is null');
    }
    var Q = ecurve.Point.decodeFrom(curve, publicKey);
    var res = new bitcoin.HDNode(new bitcoin.ECPair(null, Q, { network: network }), chainCode);

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
        var node = bitcoin.HDNode.fromBase58(original); // use bitcoin magic

        // "hard-fix" the new network into the HDNode keypair
        node.keyPair.network = network;
        return node.toBase58();
    }
}

// converts from internal PublicKey format to bitcoin.js HDNode
// network info is necessary. throws error on wrong xpub
function pubKey2bjsNode(key, network) {
    var keyNode = key.message.node;
    var bjsNode = pubNode2bjsNode(keyNode, network);

    var bjsXpub = bjsNode.toBase58();
    var keyXpub = convertXpub(key.message.xpub, network);

    if (bjsXpub !== keyXpub) {
        throw new Error('Invalid public key transmission detected - ' + 'invalid xpub check. ' + 'Key: ' + bjsXpub + ', ' + 'Received: ' + keyXpub);
    }

    return bjsNode;
}

function checkDerivation(parBjsNode, childBjsNode, suffix) {
    var derivedChildBjsNode = parBjsNode.derive(suffix);

    var derivedXpub = derivedChildBjsNode.toBase58();
    var compXpub = childBjsNode.toBase58();

    if (derivedXpub !== compXpub) {
        throw new Error('Invalid public key transmission detected - ' + 'invalid child cross-check. ' + 'Computed derived: ' + derivedXpub + ', ' + 'Computed received: ' + compXpub);
    }
}

function derivePubKeyHash(nodes, nodeIx, addressIx) {
    var node = nodes[nodeIx].derive(addressIx);
    var pkh = node.getIdentifier();
    return pkh;
}

function getHDNode(session, path) {
    var network = arguments.length <= 2 || arguments[2] === undefined ? bitcoin.networks.bitcoin : arguments[2];

    var suffix = 0;
    var childPath = path.concat([suffix]);

    return session.getPublicKey(path).then(function (resKey) {
        var resNode = pubKey2bjsNode(resKey, network);

        return session.getPublicKey(childPath).then(function (childKey) {
            var childNode = pubKey2bjsNode(childKey, network);

            checkDerivation(resNode, childNode, suffix);
            return resNode;
        });
    });
}
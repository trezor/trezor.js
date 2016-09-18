'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.signBjsTx = signBjsTx;

var _bitcoinjsLib = require('bitcoinjs-lib');

var bitcoin = _interopRequireWildcard(_bitcoinjsLib);

var _trezortypes = require('../trezortypes');

var trezor = _interopRequireWildcard(_trezortypes);

var _hdnode = require('./hdnode');

var hdnodeUtils = _interopRequireWildcard(_hdnode);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function input2trezor(input) {
    const hash = input.hash;
    const index = input.index;
    const path = input.path;

    return {
        prev_index: index,
        prev_hash: reverseBuffer(hash).toString('hex'),
        address_n: path
    };
}

function _flow_makeArray(a) {
    if (!Array.isArray(a)) {
        throw new Error('Both address and path of an output cannot be null.');
    }
    const res = [];
    a.forEach(k => {
        if (typeof k === 'number') {
            res.push(k);
        }
    });
    return res;
}

function output2trezor(output, network) {
    if (output.address == null) {
        if (!output.path) {
            throw new Error('Both address and path of an output cannot be null.');
        }

        const pathArr = _flow_makeArray(output.path);

        return {
            address_n: pathArr,
            amount: output.value,
            script_type: 'PAYTOADDRESS'
        };
    }
    const address = output.address;
    if (typeof address !== 'string') {
        throw new Error('Wrong type.');
    }
    const scriptType = getAddressScriptType(address, network);

    return {
        address: address,
        amount: output.value,
        script_type: scriptType
    };
}

function signedTx2refTx(signedTx) {
    const res = bitcoin.Transaction.fromHex(signedTx.message.serialized.serialized_tx);
    return res;
}

function bjsTx2refTx(tx) {
    return {
        lock_time: tx.locktime,
        version: tx.version,
        hash: tx.getId(),
        inputs: tx.ins.map(input => {
            return {
                prev_index: input.index,
                sequence: input.sequence,
                prev_hash: reverseBuffer(input.hash).toString('hex'),
                script_sig: input.script.toString('hex')
            };
        }),
        bin_outputs: tx.outs.map(output => {
            return {
                amount: output.value,
                script_pubkey: output.script.toString('hex')
            };
        })
    };
}

function _flow_getPathOrAddress(output) {
    if (output.path) {
        const path = output.path;
        return _flow_makeArray(path);
    }
    if (typeof output.address === 'string') {
        return output.address;
    }
    throw new Error('Wrong output type.');
}

function deriveOutputScript(pathOrAddress, nodes, network) {
    const scriptType = typeof pathOrAddress === 'string' ? getAddressScriptType(pathOrAddress, network) : 'PAYTOADDRESS';

    const pkh = typeof pathOrAddress === 'string' ? bitcoin.address.fromBase58Check(pathOrAddress).hash : hdnodeUtils.derivePubKeyHash(nodes, pathOrAddress[pathOrAddress.length - 2], pathOrAddress[pathOrAddress.length - 1]);

    if (scriptType === 'PAYTOADDRESS') {
        return bitcoin.script.pubKeyHashOutput(pkh);
    }
    if (scriptType === 'PAYTOSCRIPTHASH') {
        return bitcoin.script.scriptHashOutput(pkh);
    }
    throw new Error('Unknown script type ' + scriptType);
}

function verifyBjsTx(inputs, outputs, nodes, resTx, network) {
    if (inputs.length !== resTx.ins.length) {
        throw new Error('Signed transaction has wrong length.');
    }
    if (outputs.length !== resTx.outs.length) {
        throw new Error('Signed transaction has wrong length.');
    }

    outputs.map((output, i) => {
        if (output.value !== resTx.outs[i].value) {
            throw new Error('Signed transaction has wrong output value.');
        }
        if (output.address == null && output.path == null) {
            throw new Error('Both path and address cannot be null.');
        }

        const addressOrPath = _flow_getPathOrAddress(output);
        const scriptA = deriveOutputScript(addressOrPath, nodes, network);
        const scriptB = resTx.outs[i].script;
        if (scriptA.compare(scriptB) !== 0) {
            throw new Error('Scripts differ');
        }
    });
}

function getAddressScriptType(address, network) {
    const decoded = bitcoin.address.fromBase58Check(address);
    if (decoded.version === network.pubKeyHash) {
        return 'PAYTOADDRESS';
    }
    if (decoded.version === network.scriptHash) {
        return 'PAYTOSCRIPTHASH';
    }
    throw new Error('Unknown address type.');
}

function signBjsTx(session, info, refTxs, nodes, coinName) {
    const network = bitcoin.networks[coinName.toLowerCase()];
    if (network == null) {
        return Promise.reject(new Error('No network ' + coinName));
    }

    const trezorInputs = info.inputs.map(i => input2trezor(i));
    const trezorOutputs = info.outputs.map(o => output2trezor(o, network));
    const trezorRefTxs = refTxs.map(tx => bjsTx2refTx(tx));

    return session.signTx(trezorInputs, trezorOutputs, trezorRefTxs, coinName).then(tx => signedTx2refTx(tx)).then(res => {
        verifyBjsTx(info.inputs, info.outputs, nodes, res, network);
        return res;
    });
}

function reverseBuffer(buf) {
    const copy = new Buffer(buf.length);
    buf.copy(copy);
    [].reverse.call(copy);
    return copy;
}
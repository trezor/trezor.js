/* @flow */
'use strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as types from '../flowtypes';
import * as hdnodeUtils from './hdnode';

function input2trezor(input: types.InputInfo): types.TransactionInput {
    const {hash, index, path} = input;
    return {
        prev_index: index,
        prev_hash: reverseBuffer(hash).toString('hex'),
        address_n: path,
    };
}

function output2trezor(output: types.OutputInfo, network: bitcoin.Network): types.TransactionOutput {
    if (output.address == null) {
        if (output.path == null) {
            throw new Error('Both address and path of an output cannot be null.');
        }
        return {
            address_n: output.path,
            amount: output.value,
            script_type: 'PAYTOADDRESS',
        };
    }
    const address: string = output.address;
    const scriptType = getAddressScriptType(address, network);

    return {
        address: address,
        amount: output.value,
        script_type: scriptType,
    };
}

function signedTx2refTx(signedTx: types.MessageResponse<types.SignedTx>): bitcoin.Transaction {
    const res = bitcoin.Transaction.fromHex(signedTx.message.serialized.serialized_tx);
    return res;
}

function bjsTx2refTx(tx: bitcoin.Transaction): types.RefTransaction {
    return {
        lock_time: tx.locktime,
        version: tx.version,
        hash: tx.getId(),
        inputs: tx.ins.map((input: bitcoin.Input) => {
            return {
                prev_index: input.index,
                sequence: input.sequence,
                prev_hash: reverseBuffer(input.hash).toString('hex'),
                script_sig: input.script.toString('hex'),
            };
        }),
        bin_outputs: tx.outs.map((output: bitcoin.Output) => {
            return {
                amount: output.value,
                script_pubkey: output.script.toString('hex'),
            };
        }),
    };
}

function deriveOutputScript(
    pathOrAddress: string | Array<number>,
    nodes: Array<bitcoin.HDNode>,
    network: bitcoin.Network
): Buffer {
    const scriptType = typeof pathOrAddress === 'string'
                        ? getAddressScriptType(pathOrAddress, network)
                        : 'PAYTOADDRESS';

    const pkh: Buffer = typeof pathOrAddress === 'string'
                                ? bitcoin.address.fromBase58Check(pathOrAddress).hash
                                : hdnodeUtils.derivePubKeyHash(
                                      nodes,
                                      pathOrAddress[pathOrAddress.length - 2],
                                      pathOrAddress[pathOrAddress.length - 1]
                                );

    if (scriptType === 'PAYTOADDRESS') {
        return bitcoin.script.pubKeyHashOutput(pkh);
    }
    if (scriptType === 'PAYTOSCRIPTHASH') {
        return bitcoin.script.scriptHashOutput(pkh);
    }
    throw new Error('Unknown script type ' + scriptType);
}

function verifyBjsTx(
    inputs: Array<types.InputInfo>,
    outputs: Array<types.OutputInfo>,
    nodes: Array<bitcoin.HDNode>,
    resTx: bitcoin.Transaction,
    network: bitcoin.Network
) {
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

        const addressOrPath_: ?(string | Array<number>) =
            output.address == null ? (output.path == null ? null : output.path) : output.address;

        if (addressOrPath_ == null) {
            throw new Error('Both path and address cannot be null.');
        }

        const addressOrPath: (string | Array<number>) = addressOrPath_;
        const scriptA: Buffer =
            deriveOutputScript(addressOrPath, nodes, network);
        const scriptB: Buffer = resTx.outs[i].script;
        if (scriptA.compare(scriptB) !== 0) {
            throw new Error('Scripts differ');
        }
    });
}

function getAddressScriptType(address: string, network: bitcoin.Network): string {
    const decoded = bitcoin.address.fromBase58Check(address);

    if (decoded.version === network.pubKeyHash) {
        return 'PAYTOADDRESS';
    }

    if (decoded.version === network.scriptHash) {
        return 'PAYTOSCRIPTHASH';
    }

    throw new Error('Unknown address type.');
}

export function signBjsTx(
    info: types.TxInfo,
    refTxs: Array<bitcoin.Transaction>,
    nodes: Array<bitcoin.HDNode>,
    coinName: string
): Promise<bitcoin.Transaction> {
    const network: bitcoin.Network = bitcoin.networks[coinName.toLowerCase()];
    if (network == null) {
        return Promise.reject(new Error('No network ' + coinName));
    }

    const trezorInputs: Array<types.TransactionInput> = info.inputs.map(i => input2trezor(i));
    const trezorOutputs: Array<types.TransactionOutput> =
        info.outputs.map(o => output2trezor(o, network));
    const trezorRefTxs: Array<types.RefTransaction> = refTxs.map(tx => bjsTx2refTx(tx));

    return this.signTx(
        trezorInputs,
        trezorOutputs,
        trezorRefTxs,
        coinName
    ).then(tx => signedTx2refTx(tx))
    .then(res => {
        verifyBjsTx(info.inputs, info.outputs, nodes, res, network);
        return res;
    });
}

function reverseBuffer(buf: Buffer): Buffer {
    const copy = new Buffer(buf.length);
    buf.copy(copy);
    [].reverse.call(copy);
    return copy;
}

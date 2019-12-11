/* @flow */
'use strict';

import bchaddr from 'bchaddrjs';
import * as bitcoin from '@trezor/utxo-lib';
import * as trezor from '../trezortypes';
import * as hdnodeUtils from './hdnode';

bitcoin.Transaction.USE_STRING_VALUES = true;

import type Session, {MessageResponse} from '../session';

// TODO refactor this using string types
export type OutputInfo = {|
    path: Array<number>;
    value: string;
    segwit: boolean;
|} | {|
    address: string;
    value: string;
|} | {|
    opReturnData: Buffer;
|};

export type InputInfo = {
    hash: Buffer;
    index: number;
    path: Array<number>;
    segwit: boolean;
    amount?: string; // only with segwit
};

export type TxInfo = {
    inputs: Array<InputInfo>;
    outputs: Array<OutputInfo>;
};

function input2trezor(input: InputInfo, sequence: number): trezor.TransactionInput {
    const {hash, index, path, amount} = input;
    return {
        prev_index: index,
        prev_hash: reverseBuffer(hash).toString('hex'),
        address_n: path,
        script_type: input.segwit ? 'SPENDP2SHWITNESS' : 'SPENDADDRESS',
        amount,
        sequence,
    };
}

function _flow_makeArray(a: mixed): Array<number> {
    if (!(Array.isArray(a))) {
        throw new Error('Both address and path of an output cannot be null.');
    }
    const res: Array<number> = [];
    a.forEach(k => {
        if (typeof k === 'number') {
            res.push(k);
        }
    });
    return res;
}

function output2trezor(output: OutputInfo, network: bitcoin.Network, isCashaddress: ?boolean): trezor.TransactionOutput {
    if (output.address == null) {
        if (output.opReturnData != null) {
            if (output.value != null) {
                throw new Error('Wrong type.');
            }

            const data: Buffer = output.opReturnData;
            return {
                amount: '0',
                op_return_data: data.toString('hex'),
                script_type: 'PAYTOOPRETURN',
            };
        }

        if (!output.path) {
            throw new Error('Both address and path of an output cannot be null.');
        }

        const pathArr: Array<number> = _flow_makeArray(output.path);

        const amount: string = output.value;
        if (output.segwit) {
            return {
                address_n: pathArr,
                amount,
                script_type: 'PAYTOP2SHWITNESS',
            };
        } else {
            return {
                address_n: pathArr,
                amount,
                script_type: 'PAYTOADDRESS',
            };
        }
    }
    const address = output.address;
    if (typeof address !== 'string') {
        throw new Error('Wrong type.');
    }

    // $FlowIssue
    const amount: string = output.value;

    isScriptHash(address, network, isCashaddress);

    // cashaddr hack, internally we work only with legacy addresses, but we output cashaddr
    return {
        address: isCashaddress ? bchaddr.toCashAddress(address) : address,
        amount: amount,
        script_type: 'PAYTOADDRESS',
    };
}

function signedTx2bjsTx(signedTx: MessageResponse<trezor.SignedTx>, network: bitcoin.Network): bitcoin.Transaction {
    const res = bitcoin.Transaction.fromHex(signedTx.message.serialized.serialized_tx, network);
    return res;
}

function bjsTx2refTx(tx: bitcoin.Transaction): trezor.RefTransaction {
    const extraData = tx.getExtraData();
    const version_group_id = bitcoin.coins.isZcash(tx.network) ? parseInt(tx.versionGroupId, 16) : null;
    return {
        lock_time: tx.locktime,
        version: tx.isDashSpecialTransaction() ? tx.version | tx.type << 16 : tx.version,
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
                amount: typeof output.value === 'number' ? output.value.toString() : output.value,
                script_pubkey: output.script.toString('hex'),
            };
        }),
        extra_data: extraData ? extraData.toString('hex') : null,
        version_group_id,
    };
}

function _flow_getPathOrAddress(output: OutputInfo): string | Array<number> {
    if (output.path) {
        const path = output.path;
        return _flow_makeArray(path);
    }
    if (typeof output.address === 'string') {
        return output.address;
    }
    throw new Error('Wrong output type.');
}

function _flow_getSegwit(output: OutputInfo): boolean {
    if (output.segwit) {
        return true;
    }
    return false;
}

function deriveWitnessOutput(pkh) {
    // see https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki
    // address derivation + test vectors
    const scriptSig = new Buffer(pkh.length + 2);
    scriptSig[0] = 0;
    scriptSig[1] = 0x14;
    pkh.copy(scriptSig, 2);
    const addressBytes = bitcoin.crypto.hash160(scriptSig);
    const scriptPubKey = new Buffer(23);
    scriptPubKey[0] = 0xa9;
    scriptPubKey[1] = 0x14;
    scriptPubKey[22] = 0x87;
    addressBytes.copy(scriptPubKey, 2);
    return scriptPubKey;
}

function deriveOutputScript(
    pathOrAddress: string | Array<number>,
    nodes: Array<bitcoin.HDNode>,
    network: bitcoin.Network,
    segwit: boolean
): Buffer {
    const scriptType = typeof pathOrAddress === 'string'
        ? (isScriptHash(pathOrAddress, network) ? 'PAYTOSCRIPTHASH' : 'PAYTOADDRESS')
        : (segwit ? 'PAYTOP2SHWITNESS' : 'PAYTOADDRESS');

    if (typeof pathOrAddress === 'string' && isBech32(pathOrAddress)) {
        const data = bitcoin.address.fromBech32(pathOrAddress).data;
        if (scriptType === 'PAYTOADDRESS') {
            return bitcoin.script.witnessPubKeyHash.output.encode(data);
        }

        if (scriptType === 'PAYTOSCRIPTHASH') {
            return bitcoin.script.witnessScriptHash.output.encode(data);
        }

        throw new Error('Unknown script type ' + scriptType);
    }

    const pkh: Buffer = typeof pathOrAddress === 'string'
        ? bitcoin.address.fromBase58Check(pathOrAddress).hash
        : hdnodeUtils.derivePubKeyHash(
            nodes,
            pathOrAddress[pathOrAddress.length - 2],
            pathOrAddress[pathOrAddress.length - 1]
        );

    if (scriptType === 'PAYTOADDRESS') {
        return bitcoin.script.pubKeyHash.output.encode(pkh);
    }

    if (scriptType === 'PAYTOSCRIPTHASH') {
        return bitcoin.script.scriptHash.output.encode(pkh);
    }

    if (scriptType === 'PAYTOP2SHWITNESS') {
        return deriveWitnessOutput(pkh);
    }

    throw new Error('Unknown script type ' + scriptType);
}

function verifyBjsTx(
    inputs: Array<InputInfo>,
    outputs: Array<OutputInfo>,
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
        const scriptB = resTx.outs[i].script;

        if (output.opReturnData instanceof Buffer) {
            const scriptA = bitcoin.script.nullData.output.encode(output.opReturnData);
            if (scriptA.compare(scriptB) !== 0) {
                throw new Error('Scripts differ');
            }
        } else {
            if (output.value !== resTx.outs[i].value) {
                throw new Error('Signed transaction has wrong output value.');
            }
            if (output.address === null && output.path === null) {
                throw new Error('Both path and address cannot be null.');
            }

            const addressOrPath = _flow_getPathOrAddress(output);
            const segwit = _flow_getSegwit(output);
            const scriptA = deriveOutputScript(addressOrPath, nodes, network, segwit);
            if (scriptA.compare(scriptB) !== 0) {
                throw new Error('Scripts differ');
            }
        }
    });
}

function isBech32(address: string): boolean {
    try {
        bitcoin.address.fromBech32(address);
        return true;
    } catch (e) {
        return false;
    }
}

function isScriptHash(address: string, network: bitcoin.Network, isCashaddress: ?boolean): boolean {
    // cashaddr hack
    // Cashaddr format (with prefix) is neither base58 nor bech32, so it would fail
    // in trezor-utxo-lib. For this reason, we use legacy format here
    try {
        if (isCashaddress) {
            address = bchaddr.toLegacyAddress(address);
        }
    } catch (err) {
        throw new Error('Received cashaddr address could not be translated to legacy format for purpose of internal checks');
    }
    if (!isBech32(address)) {
        const decoded = bitcoin.address.fromBase58Check(address);
        if (decoded.version === network.pubKeyHash) {
            return false;
        }
        if (decoded.version === network.scriptHash) {
            return true;
        }
    } else {
        const decoded = bitcoin.address.fromBech32(address);
        if (decoded.data.length === 20) {
            return false;
        }
        if (decoded.data.length === 32) {
            return true;
        }
    }
    throw new Error('Unknown address type.');
}

export function signBjsTx(
    session: Session,
    info: TxInfo,
    refTxs: Array<bitcoin.Transaction>,
    nodes: Array<bitcoin.HDNode>,
    coinName: string,
    network_: ?bitcoin.Network,
    locktime: ?number,
    isCashaddress: ?boolean,
    overwintered: ?boolean,
): Promise<bitcoin.Transaction> {
    const network: bitcoin.Network = network_ == null ? bitcoin.networks[coinName.toLowerCase()] : network_;
    if (network == null) {
        return Promise.reject(new Error('No network ' + coinName));
    }

    // TODO rbf
    const sequence = locktime ? (0xffffffff - 1) : 0xffffffff;

    const trezorInputs: Array<trezor.TransactionInput> = info.inputs.map(i => input2trezor(i, sequence));
    // in case of bitcoin cash transaction, in output2trezor function actual conversion from legacy
    // to cashaddress format takes place
    const trezorOutputs: Array<trezor.TransactionOutput> =
        info.outputs.map(o => output2trezor(o, network, isCashaddress));
    const trezorRefTxs: Array<trezor.RefTransaction> = refTxs.map(tx => bjsTx2refTx(tx));

    return session.signTx(
        trezorInputs,
        trezorOutputs,
        trezorRefTxs,
        coinName,
        locktime,
        overwintered,
    ).then(tx => signedTx2bjsTx(tx, network))
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

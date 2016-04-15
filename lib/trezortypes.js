/* @flow */
'use strict';

// This file has all various types that go into TREZOR or out of it.

export type Success = {};

export type CoinType = {
    coin_name: string;
    coin_shortcut: string;
    address_type: number;
    maxfee_kb: number;
    address_type_p2sh: number;
};

export type Features = {
    vendor: string;
    major_version: number;
    minor_version: number;
    patch_version: number;
    bootloader_mode: boolean;
    device_id: string;
    pin_protection: boolean;
    passphrase_protection: boolean;
    language: string;
    label: string;
    coins: CoinType[];
    initialized: boolean;
    revision: string;
    bootloader_hash: string;
    imported: boolean;
    pin_cached: boolean;
    passphrase_cached: boolean;
};

export type ResetDeviceSettings = {
    display_random?: boolean;
    strength?: number;
    passphrase_protection?: boolean;
    pin_protection?: boolean;
    language?: string;
    label?: string;
};

export type HDPrivNode = {
    depth: number;
    fingerprint: number;
    child_num: number;
    chain_code: string;
    private_key: string;
};

export type HDPubNode = {
    depth: number;
    fingerprint: number;
    child_num: number;
    chain_code: string;
    public_key: string;
};

export type HDNode = HDPubNode | HDPrivNode;

export type LoadDeviceSettings = {
    pin?: string;
    passphrase_protection?: boolean;
    language?: string;
    label?: string;
    skip_checksum?: boolean;

    mnemonic?: string;
    node?: HDNode;
    payload?: string; // will be converted
};

export type RecoverDeviceSettings = {
    word_count?: number;
    passphrase_protection?: boolean;
    pin_protection?: boolean;
    language?: string;
    label?: string;
    enforce_wordlist?: boolean;
};

export type ApplySettings = {
    language?: string;
    label?: string;
    use_passphrase?: boolean;
    homescreen?: string;
};

export type MessageSignature = {
    address: string;
    signature: string;
}

export type TransactionInput = {
    address_n?: Array<number>;
    prev_index: number;
    sequence?: number;
    prev_hash: string;
    script_sig?: string;
};

export type TransactionOutput = {
    address: string;
    amount: number; // in satoshis
    script_type: string;
} | {
    address_n: Array<number>;
    amount: number; // in satoshis
    script_type: string;
};

export type TransactionBinOutput = {
    amount: number;
    script_pubkey: string;
};

export type RefTransaction = {
    hash: string;
    version: number;
    inputs: Array<TransactionInput>;
    bin_outputs: Array<TransactionBinOutput>;
    lock_time: number;
};

export type TxRequestDetails = {
    request_index: number;
    tx_hash?: string;
};

export type TxRequestSerialized = {
    signature_index?: number;
    signature?: string;
    serialized_tx?: string;
};

export type TxRequest = {
    request_type: 'TXINPUT' | 'TXOUTPUT' | 'TXMETA' | 'TXFINISHED';
    details: TxRequestDetails;
    serialized: TxRequestSerialized;
};

export type SignedTx = {
    serialized: {
        signatures: Array<string>;
        serialized_tx: string;
    }
};

export type Identity = {
    proto?: string;
    user?: string;
    host?: string;
    port?: string;
    path?: string;
    index?: number;
};

export type SignedIdentity = {
    address: string;
    public_key: string;
    signature: string;
};

export type PublicKey = {
    node: HDPubNode;
    xpub: string;
};

// this is what Trezor asks for
export type SignTxInfoToTrezor = {
    inputs: Array<TransactionInput>
} | {
    bin_outputs: Array<TransactionBinOutput>
} | {
    outputs: Array<TransactionOutput>
} | {
    version: number;
    lock_time: number;
    inputs_cnt: number;
    outputs_cnt: number;
};

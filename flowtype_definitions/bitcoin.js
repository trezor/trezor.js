/* @flow
 * Type definitions for bitcoinjs-lib
 */

type Network = {
    messagePrefix: string;
    bip32: {
        public: number;
        private: number;
    };
    pubKeyHash: number;
    scriptHash: number;
    wif: number;
    dustTreshold: number;
    feePerKB: number;
}

type Input = {
    script: Buffer;
    hash: Buffer;
    index: number;
    sequence: number;
};

type Output = {
    script: Buffer;
    value: number;
};

declare module 'bitcoinjs-lib' {

    declare var address: {
        fromBase58(address: string): {hash: Buffer, version: number};
        fromOutputScript(script: Buffer, network?: Network): string;
    };

    declare var script: {
        fromAddress(address: string, network?: Network): Buffer;
        pubKeyHashOutput(pkh: Buffer): Buffer;
        scriptHashOutput(sho: Buffer): Buffer;
    };
    
    declare class ECPair {
        d: ?Buffer;
        Q: ?Buffer;
        constructor(d: ?Buffer, Q: ?Buffer): void;
    }

    declare class HDNode {
        depth: number;
        fingerprint: number;
        index: number;
        keyPair: ECPair;
        chainCode: Buffer;
        static fromBase58(
            str: string,
            networks: Array<Network> | Network
        ): HDNode;
        derive(index: number): HDNode;
        toBase58(): string;
        constructor(keyPair: ECPair, chainCode: Buffer): void;
    }

    declare class Transaction {
        version: number;
        locktime: number;

        constructor(): void;
        static fromHex(hex: string): Transaction;
        ins: Array<Input>;
        outs: Array<Output>;
        toHex(): string;
    }
    
    declare var networks: {[key: string]: Network}
}


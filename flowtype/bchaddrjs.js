declare module 'bchaddrjs' {
    declare module.exports: {
        toCashAddress(address: string): string;
        isCashAddress(address: string): boolean;
        toLegacyAddress(address: string): string;
    };
}

/* @flow */
'use strict';

import * as trezor from '../trezortypes';

import type Session, {MessageResponse} from '../session';

function processTxRequest(
    session: Session,
    request: trezor.CardanoTxRequest,
    transactions: Array<string>
): Promise<MessageResponse<trezor.CardanoSignedTransaction>> {
    if (request.tx_index === null || request.tx_index === undefined) {
        return Promise.resolve({
            message: request,
            type: 'trezor.CardanoSignedTransaction',
        });
    }

    const transaction = transactions[request.tx_index];

    return session.typedCall('CardanoTxAck', 'CardanoTxRequest', {transaction: transaction}).then(
        (response) => processTxRequest(
            session,
            response.message,
            transactions
        )
    );
}

export function signAdaTx(
    session: Session,
    inputs: Array<trezor.CardanoTxInputType>,
    outputs: Array<trezor.CardanoTxOutputType>,
    transactions: Array<string>
): Promise<MessageResponse<trezor.CardanoSignedTransaction>> {
    return session.typedCall('CardanoSignTransaction', 'CardanoTxRequest', {
        inputs: inputs,
        outputs: outputs,
        transactions_count: transactions.length,
    }).then((res) =>
        processTxRequest(session, res.message, transactions)
    );
}

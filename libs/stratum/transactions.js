const util = require('./util.js');

/*
This function creates the generation transaction that accepts the reward for
successfully mining a new block.
For some (probably outdated and incorrect) documentation about whats kinda going on here,
see: https://en.bitcoin.it/wiki/Protocol_specification#tx
 */

const generateOutputTransactions = function(poolRecipient, recipients, rpcData, network) {
    let reward = rpcData.coinbasevalue;
    let rewardToPool = reward;

    const txOutputBuffers = [];

    /* Dash 12.1 */
    if (rpcData.masternode && rpcData.superblock) {
        if (rpcData.masternode.payee) {
            let payeeReward = 0;

            payeeReward = rpcData.masternode.amount;
            reward -= payeeReward;
            rewardToPool -= payeeReward;

            const payeeScript = util.addressToScript(network, rpcData.masternode.payee);
            txOutputBuffers.push(Buffer.concat([
                util.packInt64LE(payeeReward),
                util.varIntBuffer(payeeScript.length),
                payeeScript
            ]));
        } else if (rpcData.superblock.length > 0) {
            for(const i in rpcData.superblock){
                let payeeReward = 0;

                payeeReward = rpcData.superblock[i].amount;
                reward -= payeeReward;
                rewardToPool -= payeeReward;

                const payeeScript = util.addressToScript(network, rpcData.superblock[i].payee);
                txOutputBuffers.push(Buffer.concat([
                    util.packInt64LE(payeeReward),
                    util.varIntBuffer(payeeScript.length),
                    payeeScript
                ]));
            }
        }
    }

    if (rpcData.payee) {
        let payeeReward = 0;

        if (rpcData.payee_amount) {
            payeeReward = rpcData.payee_amount;
        } else {
            payeeReward = Math.ceil(reward / 5);
        }

        reward -= payeeReward;
        rewardToPool -= payeeReward;

        const payeeScript = util.addressToScript(network, rpcData.payee);
        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(payeeReward),
            util.varIntBuffer(payeeScript.length),
            payeeScript
        ]));
    }

    for (let i = 0; i < recipients.length; i++) {
        const recipientReward = Math.floor(recipients[i].percent * reward);
        rewardToPool -= recipientReward;

        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(recipientReward),
            util.varIntBuffer(recipients[i].script.length),
            recipients[i].script
        ]));
    }

    txOutputBuffers.unshift(Buffer.concat([
        util.packInt64LE(rewardToPool),
        util.varIntBuffer(poolRecipient.length),
        poolRecipient
    ]));
    
    if (rpcData.default_witness_commitment) {
        witness_commitment = Buffer.from(rpcData.default_witness_commitment, 'hex');
        txOutputBuffers.unshift(Buffer.concat([
            util.packInt64LE(0),
            util.varIntBuffer(witness_commitment.length),
            witness_commitment
        ]));
    }

    return Buffer.concat([
        util.varIntBuffer(txOutputBuffers.length),
        Buffer.concat(txOutputBuffers)
    ]);
};


exports.CreateGeneration = function(rpcData, publicKey, extraNoncePlaceholder, reward, txMessages, recipients, network, coinbaseString) {
    const txInputsCount = 1;
    const txOutputsCount = 1;
    const txVersion = txMessages === true ? 2 : 1;
    const txLockTime = 0;

    const txInPrevOutHash = "";
    const txInPrevOutIndex = Math.pow(2, 32) - 1;
    const txInSequence = 0;

    //Only required for POS coins
    const txTimestamp = reward === 'POS' ?
        util.packUInt32LE(rpcData.curtime) : Buffer.alloc(0);

    //For coins that support/require transaction comments
    const txComment = txMessages === true ?
        util.serializeString('https://github.com/zone117x/node-stratum') :
        Buffer.alloc(0);

    const scriptSigPart1 = Buffer.concat([
        util.serializeNumber(rpcData.height),
        Buffer.alloc(0),
        util.serializeNumber(Date.now() / 1000 | 0),
        Buffer.from([extraNoncePlaceholder.length])
    ]);

    const scriptSigPart2 = util.serializeString(coinbaseString || '/nodeStratum/');

    const p1 = Buffer.concat([
        util.packUInt32LE(txVersion),
        txTimestamp,

        //transaction input
        util.varIntBuffer(txInputsCount),
        util.uint256BufferFromHash(txInPrevOutHash),
        util.packUInt32LE(txInPrevOutIndex),
        util.varIntBuffer(scriptSigPart1.length + extraNoncePlaceholder.length + scriptSigPart2.length),
        scriptSigPart1
    ]);

    /*
    The generation transaction must be split at the extranonce (which located in the transaction input
    scriptSig). Miners send us unique extranonces that we use to join the two parts in attempt to create
    a valid share and/or block.
     */
    const outputTransactions = generateOutputTransactions(publicKey, recipients, rpcData, network);

    const p2 = Buffer.concat([
        scriptSigPart2,
        util.packUInt32LE(txInSequence),
        //end transaction input

        //transaction output
        outputTransactions,
        //end transaction ouput

        util.packUInt32LE(txLockTime),
        txComment
    ]);

    return [p1, p2];
};

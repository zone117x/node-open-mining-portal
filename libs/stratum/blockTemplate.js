const merkleTree = require('./merkleTree.js');
const transactions = require('./transactions.js');
const util = require('./util.js');

/**
 * The BlockTemplate class holds a single job.
 * and provides several methods to validate and submit it to the daemon coin
**/
module.exports = function BlockTemplate(jobId, rpcData, poolAddressScript, extraNoncePlaceholder, reward, txMessages, recipients, network, coinbaseString) {
    //private members
    const submits = [];

    function getMerkleHashes(steps) {
        return steps.map(function(step){
            return step.toString('hex');
        });
    }

    function getTransactionBuffers(txs) {
        const txHashes = txs.map(function(tx){
            if (tx.txid) {
                return util.uint256BufferFromHash(tx.txid);
            }
            return util.uint256BufferFromHash(tx.hash);
        });
        return [null].concat(txHashes);
    }

    function getVoteData() {
        if (!rpcData.masternode_payments) {
            return Buffer.alloc(0);
        }

        return Buffer.concat(
            [util.varIntBuffer(rpcData.votes.length)].concat(
                rpcData.votes.map(function (vt) {
                    return Buffer.from(vt, 'hex');
                })
            )
        );
    }

    //public members
    this.rpcData = rpcData;
    this.jobId = jobId;

    this.target = rpcData.target
        ? BigInt(`0x${rpcData.target}`)
        : util.bignumFromBitsHex(rpcData.bits);

    this.difficulty = parseFloat((diff1 / Number(this.target)).toFixed(9));

    this.prevHashReversed = util.reverseByteOrder(Buffer.from(rpcData.previousblockhash, 'hex')).toString('hex');
    this.transactionData = Buffer.concat(rpcData.transactions.map(function(tx) {
        return Buffer.from(tx.data, 'hex');
    }));
    this.merkleTree = new merkleTree(getTransactionBuffers(rpcData.transactions));
    this.merkleBranch = getMerkleHashes(this.merkleTree.steps);
    this.generationTransaction = transactions.CreateGeneration(
        rpcData,
        poolAddressScript,
        extraNoncePlaceholder,
        reward,
        txMessages,
        recipients,
        network,
        coinbaseString
    );

    this.serializeCoinbase = function(extraNonce1, extraNonce2) {
        return Buffer.concat([
            this.generationTransaction[0],
            extraNonce1,
            extraNonce2,
            this.generationTransaction[1]
        ]);
    };

    //https://en.bitcoin.it/wiki/Protocol_specification#Block_Headers
    this.serializeHeader = function(merkleRoot, nTime, nonce) {
        const header = Buffer.alloc(80);
        let position = 0;
        header.write(nonce, position, 4, 'hex');
        header.write(rpcData.bits, position += 4, 4, 'hex');
        header.write(nTime, position += 4, 4, 'hex');
        header.write(merkleRoot, position += 4, 32, 'hex');
        header.write(rpcData.previousblockhash, position += 32, 32, 'hex');
        header.writeUInt32BE(rpcData.version, position + 32);
        return util.reverseBuffer(header);
    };

    this.serializeBlock = function(header, coinbase) {
        return Buffer.concat([
            header,
            util.varIntBuffer(this.rpcData.transactions.length + 1),
            coinbase,
            this.transactionData,
            getVoteData(),
            //POS coins require a zero byte appended to block which the daemon replaces with the signature
            Buffer.from(reward === 'POS' ? [0] : [])
        ]);
    };

    this.registerSubmit = function(extraNonce1, extraNonce2, nTime, nonce) {
        const submission = extraNonce1 + extraNonce2 + nTime + nonce;
        if (submits.indexOf(submission) === -1){
            submits.push(submission);
            return true;
        }
        return false;
    };

    this.getJobParams = function() {
        if (!this.jobParams){
            this.jobParams = [
                this.jobId,
                this.prevHashReversed,
                this.generationTransaction[0].toString('hex'),
                this.generationTransaction[1].toString('hex'),
                this.merkleBranch,
                util.packInt32BE(this.rpcData.version).toString('hex'),
                this.rpcData.bits,
                util.packUInt32BE(this.rpcData.curtime).toString('hex'),
                true
            ];
        }
        return this.jobParams;
    };
};

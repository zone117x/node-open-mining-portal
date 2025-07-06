/*
 * Ported from https://github.com/slush0/stratum-mining/blob/master/lib/merkletree.py
 */
const util = require('./util.js');

function merkleJoin(h1, h2) {
    const joined = Buffer.concat([h1, h2]);
    const dhashed = util.sha256d(joined);
    return dhashed;
}

function calculateSteps(data) {
    let L = data;
    const steps = [];
    const PreL = [null];
    const StartL = 2;
    let Ll = L.length;

    if (Ll > 1) {
        while (true) {
            if (Ll === 1) {
                break;
            }

            steps.push(L[1]);

            if (Ll % 2) {
                L.push(L[L.length - 1]);
            }

            const Ld = [];
            const r = util.range(StartL, Ll, 2);
            r.forEach(function(i) {
                Ld.push(merkleJoin(L[i], L[i + 1]));
            });
            L = PreL.concat(Ld);
            Ll = L.length;
        }
    }
    return steps;
}

class MerkleTree {
    constructor(data) {
        this.data = data;
        this.steps = calculateSteps(data);
    }

    withFirst(f) {
        return this.steps.reduce((acc, curr) => {
            acc = util.sha256d(Buffer.concat([acc, curr]));
            return acc;
        }, f);
    }
}

module.exports = MerkleTree;

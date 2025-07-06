const crypto = require('crypto');
const base58 = require('bs58check');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@bitcoinerlab/secp256k1');

bitcoin.initEccLib(ecc);

exports.sleep = function(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

exports.addressFromEx = function(exAddress, ripdm160Key) {
    try {
        const versionByte = exports.getVersionByte(exAddress);
        const addrBase = Buffer.concat([versionByte, Buffer.from(ripdm160Key, 'hex')]);
        const checksum = exports.sha256d(addrBase).slice(0, 4);
        const address = Buffer.concat([addrBase, checksum]);
        return base58.encode(address);
    }
    catch(e){
        return null;
    }
};

exports.getVersionByte = function(addr) {
    const versionByte = base58.decode(addr).slice(0, 1);
    return versionByte;
};

exports.sha256 = function(buffer) {
    const hash1 = crypto.createHash('sha256');
    hash1.update(buffer);
    return hash1.digest();
};

exports.sha256d = function(buffer) {
    return exports.sha256(exports.sha256(buffer));
};

exports.reverseBuffer = function(buff) {
    return Buffer.from(buff).reverse();
};

exports.reverseHex = function(hex) {
    return exports.reverseBuffer(Buffer.from(hex, 'hex')).toString('hex');
};

exports.reverseByteOrder = function(buff) {
    for (let i = 0; i < 8; i++) buff.writeUInt32LE(buff.readUInt32BE(i * 4), i * 4);
    return exports.reverseBuffer(buff);
};

exports.uint256BufferFromHash = function(hex) {
    let fromHex = Buffer.from(hex, 'hex');

    if (fromHex.length != 32){
        const empty = Buffer.alloc(32);
        empty.fill(0);
        fromHex.copy(empty);
        fromHex = empty;
    }

    return exports.reverseBuffer(fromHex);
};

exports.hexFromReversedBuffer = function(buffer) {
    return exports.reverseBuffer(buffer).toString('hex');
};


/*
Defined in bitcoin protocol here:
 https://en.bitcoin.it/wiki/Protocol_specification#Variable_length_integer
 */
exports.varIntBuffer = function(n) {
    if (n < 0xfd)
        return Buffer.from([n]);
    else if (n <= 0xffff){
        const buff = Buffer.alloc(3);
        buff[0] = 0xfd;
        buff.writeUInt16LE(n, 1);
        return buff;
    }
    else if (n <= 0xffffffff){
        const buff = Buffer.alloc(5);
        buff[0] = 0xfe;
        buff.writeUInt32LE(n, 1);
        return buff;
    }
    else{
        const buff = Buffer.alloc(9);
        buff[0] = 0xff;
        exports.packUInt16LE(n).copy(buff, 1);
        return buff;
    }
};

exports.varStringBuffer = function(string) {
    const strBuff = Buffer.from(string, 'utf8');
    return Buffer.concat([exports.varIntBuffer(strBuff.length), strBuff]);
};

/*
"serialized CScript" formatting as defined here:
 https://github.com/bitcoin/bips/blob/master/bip-0034.mediawiki#specification
Used to format height and date when putting into script signature:
 https://en.bitcoin.it/wiki/Script
 */
exports.serializeNumber = function(n) {
    //New version from TheSeven
    if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
    let l = 1;
    const buff = Buffer.alloc(9);
    while (n > 0x7f)
    {
        buff.writeUInt8(n & 0xff, l++);
        n >>= 8;
    }
    buff.writeUInt8(l, 0);
    buff.writeUInt8(n, l++);
    return buff.slice(0, l);
};


/*
Used for serializing strings used in script signature
 */
exports.serializeString = function(s) {
    if (s.length < 253) {
        return Buffer.concat([
            Buffer.from([s.length]),
            Buffer.from(s, 'utf8')
        ]);
    } else if (s.length < 0x10000) {
        return Buffer.concat([
            Buffer.from([253]),
            exports.packUInt16LE(s.length),
            Buffer.from(s, 'utf8')
        ]);
    } else if (s.length < 0x100000000) {
        return Buffer.concat([
            Buffer.from([254]),
            exports.packUInt32LE(s.length),
            Buffer.from(s, 'utf8')
        ]);
    } else {
        return Buffer.concat([
            Buffer.from([255]),
            exports.packUInt16LE(s.length),
            Buffer.from(s, 'utf8')
        ]);
    }
};

exports.packUInt16LE = function(num) {
    const buff = Buffer.alloc(2);
    buff.writeUInt16LE(num, 0);
    return buff;
};
exports.packInt32LE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeInt32LE(num, 0);
    return buff;
};
exports.packInt32BE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeInt32BE(num, 0);
    return buff;
};
exports.packUInt32LE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeUInt32LE(num, 0);
    return buff;
};
exports.packUInt32BE = function(num) {
    const buff = Buffer.alloc(4);
    buff.writeUInt32BE(num, 0);
    return buff;
};
exports.packInt64LE = function(num) {
    const buff = Buffer.alloc(8);
    buff.writeUInt32LE(num % Math.pow(2, 32), 0);
    buff.writeUInt32LE(Math.floor(num / Math.pow(2, 32)), 4);
    return buff;
};


/*
An exact copy of python's range feature. Written by Tadeck:
 http://stackoverflow.com/a/8273091
 */
exports.range = function(start, stop, step) {
    if (typeof stop === 'undefined'){
        stop = start;
        start = 0;
    }
    if (typeof step === 'undefined'){
        step = 1;
    }
    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)){
        return [];
    }
    const result = [];
    for (let i = start; step > 0 ? i < stop : i > stop; i += step){
        result.push(i);
    }
    return result;
};


/*
 For POS coins - used to format wallet address for use in generation transaction's output
 */
exports.pubkeyToScript = function(key) {
    if (key.length !== 66) {
        console.error('Invalid pubkey: ' + key);
        throw new Error();
    }
    const pubkey = Buffer.alloc(35);
    pubkey[0] = 0x21;
    pubkey[34] = 0xac;
    Buffer.from(key, 'hex').copy(pubkey, 1);
    return pubkey;
};


exports.miningKeyToScript = function(key) {
    const keyBuffer = Buffer.from(key, 'hex');
    return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), keyBuffer, Buffer.from([0x88, 0xac])]);
};

/*
For POW coins - used to format wallet address for use in generation transaction's output
 */
exports.addressToScript = function(network, addr) {
    if (network) {
        return bitcoin.address.toOutputScript(addr, network);
    } else {
        return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), bitcoin.address.fromBase58Check(addr).hash, Buffer.from([0x88, 0xac])]);
    }
};

exports.checkAddress = function(network, addr) {
    try {
        bitcoin.address.toOutputScript(addr, network);
        return true;
    } catch {
        return false;
    }
}

exports.getReadableHashRateString = function(hashrate) {
    let i = -1;
    const byteUnits = [ ' KH', ' MH', ' GH', ' TH', ' PH' ];
    do {
        hashrate = hashrate / 1024;
        i++;
    } while (hashrate > 1024);
    return hashrate.toFixed(2) + byteUnits[i];
};

//Creates a non-truncated max difficulty (diff1) by bitwise right-shifting the max value of a uint256
exports.shiftMax256Right = function(shiftRight) {
    //Max value uint256 (an array of ones representing 256 enabled bits)
    let arr256 = Array.apply(null, new Array(256)).map(Number.prototype.valueOf, 1);

    //An array of zero bits for how far the max uint256 is shifted right
    const arrLeft = Array.apply(null, new Array(shiftRight)).map(Number.prototype.valueOf, 0);

    //Add zero bits to uint256 and remove the bits shifted out
    arr256 = arrLeft.concat(arr256).slice(0, 256);

    //An array of bytes to convert the bits to, 8 bits in a byte so length will be 32
    const octets = [];

    for (let i = 0; i < 32; i++) {
        octets[i] = 0;

        //The 8 bits for this byte
        const bits = arr256.slice(i * 8, i * 8 + 8);

        //Bit math to add the bits into a byte
        for (let f = 0; f < bits.length; f++) {
            const multiplier = Math.pow(2, f);
            octets[i] += bits[f] * multiplier;
        }
    }
    return Buffer.from(octets);
};


exports.bufferToCompactBits = function(startingBuff) {
    const bigNum = BigInt(`0x${startingBuff.toString('hex')}`);
    let buff = Buffer.from(bigNum.toString(16), 'hex');

    if (buff[0] > 0x7f) {
        buff = Buffer.concat([Buffer.from(0x00), buff]);
    }

    buff = Buffer.concat([Buffer.from([buff.length]), buff]);
    let compact = buff.slice(0, 4);
    return compact;
};

/*
 Used to convert getblocktemplate bits field into target if target is not included.
 More info: https://en.bitcoin.it/wiki/Target
 */

exports.bignumFromBitsBuffer = function(bitsBuff) {
    const numBytes = bitsBuff[0];
    const bigBits = BigInt(`0x${bitsBuff.slice(1).toString('hex')}`);
    const target = bigBits * (2n ** (8n * BigInt(numBytes - 3)));
    return target
};

exports.bignumFromBitsHex = function(bitsString) {
    const bitsBuff = Buffer.from(bitsString, 'hex');
    return exports.bignumFromBitsBuffer(bitsBuff);
};

exports.convertBitsToBuff = function(bitsBuff) {
    const target = exports.bignumFromBitsBuffer(bitsBuff);
    const resultBuff = Buffer.from(target.toString(16), 'hex');
    const buff256 = Buffer.alloc(32);
    resultBuff.copy(buff256, buff256.length - resultBuff.length);
    return buff256;
};

exports.getTruncatedDiff = function(shift) {
    return exports.convertBitsToBuff(exports.bufferToCompactBits(exports.shiftMax256Right(shift)));
};

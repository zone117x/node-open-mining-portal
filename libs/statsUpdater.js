const redis = require('redis');

const algos = require('./stratum/algoProperties');
const DaemonAsync = require('./stratum/daemonAsync');

function mapBlock(r, coin, currentHeight) {
    const details = r.split(':');
        
    const block = {
        coin,
        blockHash: details[0],
        txHash: details[1],
        height: Number(details[2]),
        minedby: details[3],
        time: Number(details[4]),
        serialized: r
    };

    if (currentHeight) {
        block.confirmations = currentHeight - block.height + 1;

        if (block.confirmations < 1) {
            block.confirmations = null;
        }
    }

    return block;
}

function getReadableNetworkHashRateString(hashrate) {
    hashrate = (hashrate * 1000000);
    if (hashrate < 1000000)
        return '0 Hash/s';
    var byteUnits = [' Hash/s', ' KHash/s', ' MHash/s', ' GHash/s', ' THash/s', ' PHash/s', ' EHash/s', ' ZHash/s', ' YHash/s' ];
    var i = Math.floor((Math.log(hashrate/1000) / Math.log(1000)) - 1);
    hashrate = (hashrate/1000) / Math.pow(1000, i + 1);
    return hashrate.toFixed(2) + byteUnits[i];
}

function readableSeconds(t) {
    var seconds = Math.round(t);
    var minutes = Math.floor(seconds/60);
    var hours = Math.floor(minutes/60);
    var days = Math.floor(hours/24);
    hours = hours-(days*24);
    minutes = minutes-(days*24*60)-(hours*60);
    seconds = seconds-(days*24*60*60)-(hours*60*60)-(minutes*60);
    if (days > 0) { return (days + 'd ' + hours + 'h ' + minutes + 'm ' + seconds + 's'); }
    if (hours > 0) { return (hours + 'h ' + minutes + 'm ' + seconds + 's'); }
    if (minutes > 0) {return (minutes + 'm ' + seconds + 's'); }
    return (seconds + 's');
}

async function coinUpdater(logger, portalConfig, poolConfig) {
    const coin = poolConfig.coin.name;
    const logSystem = 'StatsUpdater';
    const logComponent = coin;

    const daemonAsync = new DaemonAsync(poolConfig.daemons[0]);
    const redisClient = redis.createClient(poolConfig.redis.port, poolConfig.redis.host);

    const statsConfig = portalConfig.website.stats;

    const multiAsync = (commands) => {
        return new Promise((resolve, reject) => {
            redisClient.multi(commands).exec((err, replies) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(replies);
                }
            });
        });
    };

    try {
        const rpcCommands = [
            ['getmininginfo', []],
            ['getnetworkinfo', []]
        ];
    
        const rpcResult = await daemonAsync.batchCmd(rpcCommands);
    
        const networkSols = rpcResult[0]?.networkhashps ? Number(rpcResult[0].networkhashps) : 0;
    
        const netStats = {
            networkBlocks: rpcResult[0]?.blocks ? Number(rpcResult[0].blocks) : 0,
            networkSols: networkSols,
            networkSolsString: getReadableNetworkHashRateString(networkSols),
            networkDiff: (typeof rpcResult[0]?.difficulty === 'object')
                ? rpcResult[0].difficulty['proof-of-work']
                : rpcResult[0]?.difficulty
                    ? rpcResult[0].difficulty
                    : 0,
            networkConnections: rpcResult[1]?.connections ? Number(rpcResult[1].connections) : 0,
            networkVersion: rpcResult[1]?.subversion
                ? rpcResult[1].subversion
                : rpcResult[1]?.version
                    ? rpcResult[1].version
                    : '',
            networkProtocolVersion: rpcResult[1]?.protocolversion ? Number(rpcResult[1].protocolversion) : 0,
            explorer: poolConfig.coin.explorer
        };

        const paymentStats = {};

        if (poolConfig.paymentProcessing?.enabled) {
            paymentStats.paymentEnabled = true;
            paymentStats.paymentInterval = poolConfig.paymentProcessing.paymentInterval;
            paymentStats.minimumPayment = poolConfig.paymentProcessing.minimumPayment;

            if (Object.keys(poolConfig.rewardRecipients).length) {
                paymentStats.poolFee = Object.values(poolConfig.rewardRecipients).reduce((acc, curr) => {
                    acc += Number(curr || 0);
                    return acc;
                }, 0);
            } else {
                paymentStats.poolFee = 0;
            }
        }

        const time = Date.now() / 1000 | 0;
    
        const windowTime = (time - statsConfig.hashrateWindow).toString();
    
        const redisCommands = [
            ['zremrangebyscore', `${coin}:hashrate`, '-inf', '(' + windowTime],
            ['zrangebyscore', `${coin}:hashrate`, windowTime, '+inf'],
            ['hgetall', `${coin}:stats`],
            ['scard', `${coin}:blocksPending`],
            ['scard', `${coin}:blocksConfirmed`],
            ['scard', `${coin}:blocksKicked`],
            ['hgetall', `${coin}:shares:roundCurrent`],
            ['hgetall', `${coin}:shares:timesCurrent`],
            ['hgetall', `${coin}:balances`],
            ['hgetall', `${coin}:immature`],
            ['hgetall', `${coin}:payouts`],
            // historic stats
            ['smembers', `${coin}:blocksPending`],
            ['smembers', `${coin}:blocksConfirmed`],
            ['zrange', `${coin}:payments`, -100, -1],
        ];
    
        const redisResult = await multiAsync(redisCommands);
    
        const hashrates = redisResult[1];
        const redisStats = redisResult[2];
    
        const coinStats = {
            name: coin,
            fullName: poolConfig.coin.fullName,
            blockTime: poolConfig.coin.blockTime,
            symbol: poolConfig.coin.symbol.toUpperCase(),
            algorithm: poolConfig.coin.algorithm,
            poolStats: {
                validShares: redisStats?.validShares ? Number(redisStats.validShares) : 0,
                validBlocks: redisStats?.validBlocks ? Number(redisStats.validBlocks) : 0,
                invalidShares: redisStats?.invalidShares ? Number(redisStats.invalidShares) : 0,
                totalPaid: redisStats?.totalPaid ? Number(redisStats.totalPaid) : 0,
                ...paymentStats,
                ...netStats,
            },
            blocks: {
                pending: redisResult[3],
                confirmed: redisResult[4],
                orphaned: redisResult[5]
            }
        };
    
        let coinShares = 0;
    
        // Build workers object
        let workers = hashrates.reduce((acc, ins) => {
            const parts = ins.split(':');
            const workerShares = Number(parts[0]);
            const worker = parts[1];
            const diff = Math.round(workerShares * 8192);
    
            if (!acc[worker]) {
                acc[worker] = {
                    name: worker,
                    coin,
                    address: worker.split('.')[0],
                    time,
                    diff: 0,
                    shares: 0,
                    invalidshares: 0,
                    currRoundShares: 0,
                    currRoundTime: 0,
                    hashrate: 0,
                    hashrateString: '',
                    luckDays: '',
                    luckHours: '',
                    luckMinute: ''
                };
            }
    
            if (workerShares > 0) {
                coinShares += workerShares;
    
                if (acc[worker].shares) {
                    acc[worker].shares += workerShares;
                } else {
                    acc[worker].shares = workerShares;
                }

                acc[worker].time = time;
                acc[worker].diff = diff;
            } else {
                if (acc[worker].invalidshares) {
                    // workerShares is negative number!
                    acc[worker].invalidshares -= workerShares;
                } else {
                    acc[worker].invalidshares = -workerShares;
                }
            }
    
            return acc;
        }, {});

        // Sort workers in alphabetical order
        workers = Object.values(workers).sort((a, b) => a.name.localeCompare(b.name)).reduce((acc, curr) => {
            acc[curr.name] = curr;
            return acc;
        }, {});
    
        const shareMultiplier = Math.pow(2, 32) / algos[coinStats.algorithm].multiplier;
        const hashrate = shareMultiplier * coinShares / statsConfig.hashrateWindow;
    
        coinStats.hashrate = hashrate;
        coinStats.hashrateString = getReadableNetworkHashRateString(hashrate);
    
        const blockTime = coinStats.blockTime;
        const networkHashRate = netStats.networkSols;
    
        coinStats.luckDays =  ((networkHashRate / hashrate * blockTime) / (24 * 60 * 60)).toFixed(3);
        coinStats.luckHours = ((networkHashRate / hashrate * blockTime) / (60 * 60)).toFixed(3);
        coinStats.luckMinute = ((networkHashRate / hashrate * blockTime) / (60)).toFixed(3);
    
        // Fill out other fields of workers
        let shareCount = 0;
        let maxRoundTime = 0;
    
        const currentRoundShares = redisResult[6] || {};
        const currentRoundTimes = redisResult[7] || {};

        const balances = redisResult[8] || {};
        const immatures = redisResult[9] || {};
        const payouts = redisResult[10] || {};
    
        Object.keys(workers).forEach(workerId => {
            const worker = workers[workerId];
            const workerRate = shareMultiplier * worker.shares / statsConfig.hashrateWindow;

            worker.currRoundShares = Number(currentRoundShares[workerId] || 0);
            worker.currRoundTime = Number(currentRoundTimes[workerId] || 0);

            if (worker.currRoundShares) {
                shareCount += worker.currRoundShares;
            }
            if (maxRoundTime < worker.currRoundTime) {
                maxRoundTime = worker.currRoundTime;
            }

            worker.hashrate = workerRate;
            worker.hashrateString = getReadableNetworkHashRateString(workerRate);
            
            worker.luckDays = ((networkHashRate / workerRate * blockTime) / (24 * 60 * 60)).toFixed(3);
            worker.luckHours = ((networkHashRate / workerRate * blockTime) / (60 * 60)).toFixed(3);
            worker.luckMinute = ((networkHashRate / workerRate * blockTime) / (60)).toFixed(3);
        });

        let miners = Object.keys(workers).reduce((acc, workerId) => {
            const worker = workers[workerId];
            const { address } = worker;

            if (!acc[address]) {
                acc[address] = {
                    coin: worker.coin,
                    address: address,
                    time: 0,
                    shares: 0,
                    invalidshares: 0,
                    currRoundShares: 0,
                    currRoundTime: 0,
                    hashrate: 0,
                    hashrateString: '',
                    luckDays: '',
                    luckHours: '',
                    luckMinute: '',
                    balance: 0,
                    immature: 0,
                    paid: 0,
                };
            }

            acc[address].time = time;
            acc[address].shares += worker.shares;
            acc[address].invalidshares += worker.invalidshares;
            acc[address].currRoundShares += worker.currRoundShares;
            acc[address].currRoundTime += worker.currRoundTime;
            acc[address].hashrate += worker.hashrate;

            acc[address].hashrateString = getReadableNetworkHashRateString(acc[address].hashrate);
            acc[address].luckDays = ((networkHashRate / acc[address].hashrate * blockTime) / (24 * 60 * 60)).toFixed(3);
            acc[address].luckHours = ((networkHashRate / acc[address].hashrate * blockTime) / (60 * 60)).toFixed(3);
            acc[address].luckMinute = ((networkHashRate / acc[address].hashrate * blockTime) / (60)).toFixed(3);

            acc[address].balance = Number(balances[address] || 0);
            acc[address].immature = Number(immatures[address] || 0);
            acc[address].paid = Number(payouts[address] || 0);

            return acc;
        }, {});

        // Sort miners by hashrate
        miners = Object.values(miners).sort((a, b) => b.hashrate - a.hashrate).reduce((acc, curr) => {
            acc[curr.address] = curr;
            return acc;
        }, {});

        // Get unique set of addresses
        coinStats.minerCount = Object.keys(miners).length;
        coinStats.workerCount = Object.keys(workers).length;

        coinStats.shareCount = shareCount;
        coinStats.maxRoundTime = maxRoundTime;
        coinStats.maxRoundTimeString = readableSeconds(maxRoundTime);

        coinStats.miners = miners;
        coinStats.workers = workers;

        /**
         * Historic blocks
         */
        const networkBlocks = netStats.networkBlocks;

        const pendingBlocks = redisResult[11];
        const confirmedBlocks = redisResult[12];
        const payments = redisResult[13];

        coinStats.pendingBlocks = pendingBlocks
            .map(b => mapBlock(b, coin, networkBlocks))
            .sort((a, b) => b.height - a.height);
        coinStats.confirmedBlocks = confirmedBlocks
            .map(b => mapBlock(b, coin, networkBlocks))
            .sort((a, b) => b.height - a.height);
        coinStats.payments = payments
            .map(p => JSON.parse(p))
            .sort((a, b) => b.time - a.time);
    
        return coinStats;
    } catch (error) {
        logger.error(logSystem, logComponent, `Failed to retrieve stats for ${logComponent}`);
        throw error;
    }
}

async function updater(logger, portalConfig, poolConfigs) {
    try {
        const redisClient = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
        
        const statsConfig = portalConfig.website.stats;
        
        const multiAsync = (commands) => {
            return new Promise((resolve, reject) => {
                redisClient.multi(commands).exec((err, replies) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(replies);
                    }
                });
            });
        };

        const allCoins = Object.keys(poolConfigs);
        const allCoinStats = (await Promise.all(allCoins.map(coin => coinUpdater(logger, portalConfig, poolConfigs[coin]))))
            .reduce((acc, curr, index) => {
                acc[allCoins[index]] = curr;
                return acc;
            }, {});

        const global = {
            workers: 0,
            // This doesn't make sense but it is available on the API so we leave it as zero
            hashrate: 0,
        };

        const removeCommands = [];

        const statGatherTime = Date.now() / 1000 | 0;

        const retentionTime = statGatherTime - statsConfig.historicalRetention;

        const algos = Object.keys(allCoinStats).reduce((acc, coin) => {
            const coinStats = allCoinStats[coin];
            const algorithm = coinStats.algorithm;

            if (!acc[algorithm]) {
                acc[algorithm] = {
                    workers: 0,
                    hashrate: 0,
                    hashrateString: ''
                };
            }

            global.workers += coinStats.workerCount;

            acc[algorithm].workers += coinStats.workerCount;
            acc[algorithm].hashrate += coinStats.hashrate;
            acc[algorithm].hashrateString = getReadableNetworkHashRateString(acc[algorithm].hashrate);

            // Filter out old blocks
            const oldBlocks = [];

            coinStats.confirmedBlocks = coinStats.confirmedBlocks.map(b => {
                // Blocks are fresh
                if (b.time > retentionTime) {
                    return b;
                }

                oldBlocks.push(b.serialized);
            }).filter(b => b).slice(0, 50);

            if (oldBlocks.length) {
                removeCommands.push(['srem', `${coin}:blocksConfirmed`, ...oldBlocks]);
            }

            return acc;
        }, {});

        const portalStats = {
            time: statGatherTime,
            global,
            algos,
            pools: allCoinStats
        };

        const fullStats = JSON.stringify(portalStats);

        Object.keys(portalStats.pools).forEach(coin => {
            const coinStats = portalStats.pools[coin];

            delete coinStats.miners;
            delete coinStats.pendingBlocks;
            delete coinStats.confirmedBlocks;
            delete coinStats.payments;
        });

        const stringStats = JSON.stringify(portalStats);

        await multiAsync([
            ['set', 'statCurrent', fullStats],
            ['zadd', 'statHistory', statGatherTime, stringStats],
            ['zremrangebyscore', 'statHistory', '-inf', '(' + retentionTime],
            ...removeCommands,
        ]);

        process.send({ type: 'stats', stats: stringStats });
    } catch (error) {
        logger.error('StatsUpdater', 'All', 'Failed to update stats');
        console.log(error);
    }
}

class StatsUpdater {
    constructor(logger) {
        const portalConfig = JSON.parse(process.env.portalConfig);
        const poolConfigs = JSON.parse(process.env.pools);
        const websiteConfig = portalConfig.website;

        // Wait until the payment is proceeded
        setTimeout(() => {
            updater(logger, portalConfig, poolConfigs);
            setInterval(() => updater(logger, portalConfig, poolConfigs), websiteConfig.stats.updateInterval * 1000);
        }, 1000);
    }
}

module.exports = StatsUpdater;

const fs = require('fs');

const redis = require('redis');

const Stratum = require('./stratum');
const util = require('./stratum/util.js');
const DaemonAsync = require('./stratum/daemonAsync');

function chunk(arr, size) {
    if (!arr.length || !size) {
        return [];
    }
    return [...Array(Math.ceil(arr.length / size))].map((_, i) => arr.slice(size * i, size + size * i));
}

function floorTo(n, digits = 0) {
    const multiplicator = 10 ** digits;
    return Math.floor(Number(n) * multiplicator) / multiplicator;
}

async function processPayments(pool) {
    const {
        logger,
        poolAddress,
        feePerByte,
        coin,
        logSystem,
        logComponent,
        daemon,
        daemonAsync,
        redisClient,
        decimals,
        magnitude,
        minPaymentSatoshis,
        historicalRetention,
        pplntEnabled,
        pplntTimeQualify,
    } = pool;

    /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
       when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */
    function satoshisToCoins(satoshis) {
        return floorTo(satoshis / magnitude, decimals);
    }

    function coinsToSatoshies(coins) {
        return coins * magnitude;
    }

    function floorCoins(n) {
        return floorTo(n, decimals);
    }

    // Using coinb.in style calculation
    // Returns fee applied per miners
    function calculateFee(blocksCount, minersCount) {
        // Apply max input bytes in case of other address type
        const inputBytes = blocksCount * 392;
        // Apply extra for change address
        const outputBytes = (minersCount + 1) * 34;

        return (10 + inputBytes + outputBytes) * feePerByte / minersCount;
    }

    function multiAsync(commands) {
        return new Promise((resolve, reject) => {
            redisClient.multi(commands).exec((err, replies) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(replies);
                }
            });
        });
    }

    function handleAddress(workerId) {
        return workerId.split('.')[0];
    }

    function getProperAddress(workerId) {
        if (workerId) {
            return handleAddress(workerId);
        } else {
            let addressToPay = '';

            daemon.cmd('getnewaddress', [], function(result){
                if (result.error){
                    throw new Error(JSON.stringify(result.errror));
                }
                try {
                    addressToPay = result.data;
                } catch (e) {
                    logger.error(logSystem, logComponent, 'Error getting a new address. Got: ' + result.data);
                    throw e;
                }

            }, true, true);

            return handleAddress(addressToPay);
        }
    }

    function showInterval() {
        const paymentProcessTime = Date.now() - startPaymentProcess;
        logger.debug(logSystem, logComponent,
            `Finished interval - time spent: ${paymentProcessTime} ms total, `
            + `${timeSpentRedis} ms redis, `
            + `${timeSpentRPC} ms daemon RPC`);
    }

    const startPaymentProcess = Date.now();

    let timeSpentRPC = 0;
    let timeSpentRedis = 0;

    let startTimeRedis;
    let startTimeRPC;

    const startRedisTimer = () => { startTimeRedis = Date.now(); };
    const endRedisTimer = () => { timeSpentRedis += Date.now() - startTimeRedis; };

    const startRPCTimer = () => { startTimeRPC = Date.now(); };
    const endRPCTimer = () => { timeSpentRPC += Date.now() - startTimeRPC; };

    /* 
        1. Call redis to get an array of rounds - which are coinbase transactions and block heights from submitted
        blocks.
    */
    const rounds = [];
    const miners = {};

    let minerBalances, blocksPending;

    try {
        startRedisTimer();
        [minerBalances, blocksPending] = await multiAsync([
            ['hgetall', coin + ':balances'],
            ['smembers', coin + ':blocksPending']
        ]);
        if (!minerBalances) {
            minerBalances = {};
        }
        endRedisTimer();
    } catch (error) {
        logger.error(logSystem, logComponent, 'Could not get blocks from redis');
        console.log(error);
        throw error;
    }

    Object.keys(minerBalances).forEach(miner => {
        minerBalances[miner] = coinsToSatoshies(Number(minerBalances[miner] || 0));
    });

    rounds.push(
        ...(blocksPending || [])
            .map((r) => {
                const details = r.split(':');

                return {
                    blockHash: details[0],
                    txHash: details[1],
                    height: Number(details[2]),
                    minedby: details[3],
                    time: Number(details[4]),
                    serialized: r
                };
            })
            .sort((a, b) => a.height - b.height)
    );

    /*
        2. Does a batch rpc call to daemon with all the transaction hashes to see if they are confirmed yet.
        It also adds the block reward amount to the round object - which the daemon gives also gives us.
    */
    const batchRPCCommands = rounds.map(r => {
        return [
            ['getblock', [r.blockHash]],
            ['gettransaction', [r.txHash]],
        ];
    });

    let rpcResult;

    try {
        startRPCTimer();
        rpcResult = await daemonAsync.batchCmd(batchRPCCommands.flat(), false);
        endRPCTimer();
    } catch (error) {
        logger.error(logSystem, logComponent, 'Could not get blocks from daemon');
        console.log(error);
        throw error;
    }

    const rpcRounds = chunk(rpcResult, rpcResult.length / batchRPCCommands.length);

    const kickedRounds = [];
    const orphanedRounds = [];
    const immatureRounds = [];
    const confirmedRounds = [];
    const unknownRounds = [];

    // Check if we have a duplicated blocks and if we have
    // purge only duplicated round info and preserve shares to distribute rewards
    function canDeleteShares(round) {
        return rounds.filter(r => r.height === round.height).length === 1;
    }

    rpcRounds.forEach(([blockDetails, txDetails], index) => {
        const round = rounds[index];

        if (!blockDetails || blockDetails.error) {
            logger.warning(logSystem, logComponent, `Daemon reports invalid round block ${round.height} (${round.blockHash}), kicking it`);
            round.category = 'kicked';

        } else if (!txDetails || txDetails.error) {
            logger.warning(logSystem, logComponent, `Daemon reports invalid round tx ${round.height} (${round.txHash}), kicking it`);
            round.category = 'kicked';

        } else if (!txDetails.details || (txDetails.details && txDetails.details.length === 0)) {
            logger.warning(logSystem, logComponent, `Daemon reports no details for round tx ${round.height} (${round.txHash}), kicking it`);
            round.category = 'kicked';

        } else {
            const generationTx = !poolAddress
                ? txDetails.details[0]
                : txDetails.details.find((tx) => tx.address === poolAddress);
            const confirmations = blockDetails.confirmations;

            if (!generationTx) {
                logger.error(logSystem, logComponent, `Missing output details to pool address for round tx ${round.txHash}, kicking it`);
                round.category = 'kicked';

            } else if (confirmations <= 0) {
                logger.error(logSystem, logComponent, `Round has invalid confirmations ${confirmations} ${round.height} ${round.blockHash}, kicking it`);
                round.category = 'kicked';

            } else {
                round.category = generationTx.category;
                round.confirmations = confirmations;

                if (round.category === 'generate' || round.category === 'immature') {
                    round.reward = Number(generationTx.amount || generationTx.value);
                }
            }
        }

        switch (round.category) {
        case 'kicked':
            kickedRounds.push(round);
            round.canDeleteShares = canDeleteShares(round);
            break;
        case 'orphan':
            orphanedRounds.push(round);
            round.canDeleteShares = canDeleteShares(round);
            break;
        case 'immature':
            immatureRounds.push(round);
            break;
        case 'generate':
            confirmedRounds.push(round);
            break;
        default:
            unknownRounds.push(round);
            break;
        }

        return round;
    });

    logger.debug(logSystem, logComponent,
        `Payment info: Kicked rounds: ${kickedRounds.length}, `
            + `Orphaned rounds: ${orphanedRounds.length}, `
            + `Immature rounds: ${immatureRounds.length}, `
            + `Confirmed rounds: ${confirmedRounds.length}, `
            + `Unknown rounds: ${unknownRounds.length}`
    );

    /*
        3. Does a batch redis call to get shares contributed to each round. Then calculates the reward
        amount owned to each miner for each round.
    */
    const allWorkerShares = [];
    const allWorkerTimes = [];

    try {
        startRedisTimer();

        const redisRounds = await multiAsync(
            rounds
                .map(({ height }) => [
                    ['hgetall', `${coin}:shares:round${height}`],
                    ['hgetall', `${coin}:shares:times${height}`]
                ])
                .flat()
        );

        chunk(redisRounds, 2).forEach(([workerShares, workerTimes]) => {
            allWorkerShares.push(workerShares);
            allWorkerTimes.push(workerTimes);
        });

        endRedisTimer();
    } catch (error) {
        logger.error(logSystem, logComponent, 'Check finished - redis error with multi get rounds share');
        console.log(error);
        throw error;
    }

    rounds.forEach((round, i) => {
        const workerShares = allWorkerShares[i];
        const workerTimes = allWorkerTimes[i];

        if (!workerShares || !Object.keys(workerShares).length) {
            logger.warning(logSystem, logComponent,
                `No worker shares for round: ${round.height}, blockHash: ${round.blockHash}`);
            return;
        }

        // Iterate over timeShares to find the max time spent to mine
        const maxTime = Object.keys(workerTimes).reduce((accTime, workerAddress) => {
            const workerTime = Number(workerTimes[workerAddress] || 0);
            if (accTime < workerTime) {
                accTime = workerTime;
            }
            return accTime;
        }, 0);

        /*
            Get the reward for it and calculate how much we owe each miner based on the shares they submitted during that block round.
        */
        if (round.reward) {
            const reward = round.reward * magnitude;

            let totalShares = 0;

            const minerShares = {};

            Object.keys(workerShares).forEach(workerId => {
                const minerAddress = getProperAddress(workerId);
                const miner = miners[minerAddress] = (miners[minerAddress] || {});
                // PROP shares
                let shares = Number(workerShares[workerId] || 0);
                // PPLNT share calculation
                if (pplntEnabled && maxTime) {
                    const workerTime = Number(workerTimes[minerAddress] || 0);

                    if (workerTime) {
                        const timePeriod = floorTo(workerTime / maxTime, 2);

                        if (timePeriod && timePeriod < pplntTimeQualify) {
                            const lost = shares - (shares * timePeriod);
                            shares = Math.max(shares - lost, 0);

                            /**
                            Enable this if you want to debug shares

                            const tshares = shares;

                            logger.warning(logSystem, logComponent,
                                `PPLNT: Reduced shares for ${minerAddress} `
                                + `round: ${round.height} `
                                + `workerTime: ${workerTime} `
                                + `maxTime: ${maxTime} `
                                + `sec timePeriod: ${timePeriod.toFixed(6)} `
                                + `shares: ${tshares} `
                                + `lost: ${lost} `
                                + `new: ${shares}`
                            );
                            **/
                        }

                        if (timePeriod > 1) {
                            logger.error(logSystem, logComponent,
                                `Time share period is greater than 1.0 for ${minerAddress}`
                                + `round: ${round.height} `
                                + `blockHash: ${round.blockHash}`
                            );
                            return;
                        }
                    }
                }

                minerShares[minerAddress] = (minerShares[minerAddress] || 0) + shares;
                miner.totalShares = (miner.totalShares || 0) + shares;
                totalShares += shares;
            });

            round.totalShares = totalShares;

            Object.keys(minerShares).forEach(minerAddress => {
                const miner = miners[minerAddress];
                const percent = minerShares[minerAddress] / totalShares;
                const minerRewardTotal = Math.floor(reward * percent);

                if (round.category === 'immature') {
                    miner.immature = (miner.immature || 0) + minerRewardTotal;
                } else if (round.category === 'generate') {
                    miner.reward = (miner.reward || 0) + minerRewardTotal;
                }
            });
        }
    });

    /*
        Some address aren't recognized by bitcoin core daemon so we double check with the daemon and credit as balance

        todo: think about how we could resolve this inconsistencies but since bitcoinjs tells us as an valid address wouldn't be an easy task
    */
    const addressArray = Object.keys(miners);

    const addressValidation = (await daemonAsync.batchCmd(addressArray.map(minerAddress => {
        return ['validateaddress', [minerAddress]]
    }), false)).reduce((acc, curr, index) => {
        const minerAddress = addressArray[index];

        if (curr.isvalid) {
            acc[minerAddress] = true;
        } else {
            acc[minerAddress] = false;
            logger.warning(logSystem, logComponent, `Invalid address ${minerAddress} detected from daemon`);
        }
        return acc;
    }, {});

    /*
        4. Calculate if any payments are ready to be sent and trigger them sending
        Get balance different for each address and pass it along as object of latest balances such as
        {worker1: balance1, worker2, balance2}
        when deciding the sent balance, it the difference should be -1*amount they had in db,
        if not sending the balance, the differnce should be +(the amount they earned this round)
    */
    const addressAmounts = {};
    const balanceAmounts = {};
    const shareAmounts = {};

    let totalSent = 0;
    let totalShares = 0;

    // Fees applied with estimated input size + output size divided by miners count
    const txFees = calculateFee(confirmedRounds.length, Object.keys(miners).length);

    const confirmedPayouts = confirmedRounds.reduce((acc, curr) => acc + curr.reward, 0);
    let balancePayouts = 0;

    Object.keys(miners).forEach(minerAddress => {
        const miner = miners[minerAddress];

        const minerBalance = Number(minerBalances[minerAddress] || 0);
        const minerReward = miner.reward || 0;

        const toSend = minerBalance + minerReward - txFees;

        if (addressValidation[minerAddress] && toSend >= minPaymentSatoshis) {
            miner.sent = satoshisToCoins(toSend);
            miner.balanceChange = Math.min(minerBalance, toSend) * -1;

            addressAmounts[minerAddress] = floorCoins((addressAmounts[minerAddress] || 0) + miner.sent);
        } else {
            miner.sent = 0;
            miner.balanceChange = Math.max(toSend - minerBalance, 0);

            balanceAmounts[minerAddress] = floorCoins((balanceAmounts[minerAddress] || 0) + satoshisToCoins(miner.balanceChange));
        }

        totalSent += miner.sent;
        balancePayouts += satoshisToCoins(minerBalance);

        shareAmounts[minerAddress] = (shareAmounts[minerAddress] || 0) + (miner.totalShares || 0);
    });

    if (totalSent > confirmedPayouts + balancePayouts) {
        logger.error(logSystem, logComponent, `Payment module sending overflow, have ${confirmedPayouts + balancePayouts} sending ${totalSent}`);
    }

    let txid;

    try {
        if (!poolAddress) {
            txid = 'internal';
        } else if (totalSent) {
            startRPCTimer();
            txid = await daemonAsync.cmd('sendmany', ['', addressAmounts]);
            endRPCTimer();
        }
    } catch (err) {
    // throws error as the payment failed, don't have to update redis at this case
        logger.error(logSystem, logComponent, 'Error trying to send payments with RPC sendmany');
        console.log(err);
        throw err;
    }

    /*
        Step 5 - Finally, update redis with payments
    */
    const updateCommands = [];
    const roundsToDelete = [];

    Object.keys(miners).forEach(minerAddress => {
        const miner = miners[minerAddress];
        if (miner.balanceChange) {
            updateCommands.push(['hincrbyfloat', `${coin}:balances`, minerAddress, satoshisToCoins(miner.balanceChange)]);
        }
        if (miner.sent) {
            updateCommands.push(['hincrbyfloat', `${coin}:payouts`, minerAddress, miner.sent]);
        }
        if (miner.immature) {
            updateCommands.push(['hset', `${coin}:immature`, minerAddress, satoshisToCoins(miner.immature)]);
        } else {
            updateCommands.push(['hset', `${coin}:immature`, minerAddress, 0]);
        }
    });

    rounds.forEach((r) => {
        totalShares += (r.totalShares || 0);

        switch (r.category) {
        case 'kicked':
            updateCommands.push(['smove', `${coin}:blocksPending`, `${coin}:blocksKicked`, r.serialized]);
            if (r.canDeleteShares) {
                roundsToDelete.push(`${coin}:shares:round${r.height}`);
                roundsToDelete.push(`${coin}:shares:times${r.height}`);
            }
            return;
        case 'orphan':
            updateCommands.push(['smove', `${coin}:blocksPending`, `${coin}:blocksOrphaned`, r.serialized]);
            if (r.canDeleteShares) {
                roundsToDelete.push(`${coin}:shares:round${r.height}`);
                roundsToDelete.push(`${coin}:shares:times${r.height}`);
            }
            return;
        case 'generate':
            updateCommands.push(['smove', `${coin}:blocksPending`, `${coin}:blocksConfirmed`, r.serialized]);
            roundsToDelete.push(`${coin}:shares:round${r.height}`);
            roundsToDelete.push(`${coin}:shares:times${r.height}`);
            return;
        }
    });

    if (roundsToDelete.length) {
        updateCommands.push(['del'].concat(roundsToDelete));
        updateCommands.push(['del', `${coin}:shares:blockHash`]);
    }

    if (totalSent) {
        const time = Date.now() / 1000 | 0;

        const retentionTime = time - historicalRetention;

        updateCommands.push(['hincrbyfloat', `${coin}:stats`, 'totalPaid', totalSent]);

        updateCommands.push(['zadd', `${coin}:payments`, time, JSON.stringify({
            time,
            txid,
            fee: satoshisToCoins(txFees),
            shares: totalShares,
            paid: totalSent,
            miners: Object.keys(addressAmounts).length,
            blocks: confirmedRounds.map(r => r.height),
            amounts: addressAmounts,
            balances: balanceAmounts,
            work: shareAmounts
        })]);

        updateCommands.push(['zremrangebyscore', `${coin}:payments`, '-inf', '(' + retentionTime]);
    }

    if (!updateCommands.length) {
        showInterval();
        return;
    }

    try {
        startRedisTimer();
        await multiAsync(updateCommands);
        endRedisTimer();
    } catch (error) {
        logger.error(logSystem, logComponent,
            'Payments sent but could not update redis. '
            + 'Disabling payment processing to prevent possible double-payouts. '
            + `The redis commands in ${coin}_finalRedisCommands.txt must be ran manually.`);
        console.log(error);
        fs.writeFile(`${coin}_finalRedisCommands.txt`, JSON.stringify(updateCommands), function(err){
            if (err) {
                logger.error('Could not write finalRedisCommands.txt, you are fucked.');
            }
        });
        throw error;
    }

    if (totalSent) {
        logger.debug(logSystem, logComponent,
            `Sent out a total of ${totalSent} to ${Object.keys(addressAmounts).length} miners `
            + `(From Rewards: ${confirmedPayouts}) `
            + `(From Balances: ${balancePayouts}) `
            + `(TxFee Per Miner: ${satoshisToCoins(txFees)}) `
            + `(txid: ${txid})`);
    }

    showInterval();
}

async function validateAddress(pool) {
    const { daemonAsync, poolAddress, logger, logSystem, logComponent } = pool;

    if (!poolAddress) {
        logger.debug(logSystem, logComponent, 'Pool configured to disable payments, that is good');
        return;
    }

    let validateResult;
    try {
        validateResult = await daemonAsync.cmd('validateaddress', [poolAddress]);
    } catch (error) {
        logger.error(logSystem, logComponent, 'Error with payment processing daemon');
        console.log(error);
        throw error;
    }

    if (!validateResult?.ismine) {
        let addressInfo;
        try {
            addressInfo = await daemonAsync.cmd('getaddressinfo', [poolAddress]);
        } catch (error) {
            logger.error(logSystem, logComponent, 'Error with payment processing daemon, getaddressinfo failed ... ');
            console.log(error);
            throw error;
        }

        if (!addressInfo?.ismine) {
            logger.error(logSystem, logComponent,
                'Daemon does not own pool address - payment processing can not be done with this daemon, '
                + JSON.stringify(addressInfo));
            throw new Error('Daemon does not own pool address');
        }
    }
}

async function getDecimals(pool) {
    const { daemonAsync, logger, logSystem, logComponent, processingConfig, poolOptions } = pool;

    // Static decimals instead of parsing it from daemon (js removes last 0 of Number type)
    const decimals = poolOptions.coin.decimals || 8;
    const magnitude = 10 ** decimals;
    // 1 sat/kvB
    let feerate = processingConfig.fallbackFeeRate || 0.00001;
    // We charge enough amount of tx fees to ensure we don't lose any amounts even when we have zero fees
    const multiplier = processingConfig.feeMultiplier || 2;

    try {
        feerate = (await daemonAsync.cmd('estimatesmartfee', [6])).feerate || feerate;
    } catch (error) {
        logger.error(logSystem, logComponent,
            'Error fetching fee rates from daemon, use -fallbackfee=0.00001 option to prevent this, using fallback fees.');
        console.log(error);
    }

    const feePerByte = Math.round(feerate * multiplier * magnitude / 1000);

    pool.decimals = decimals;
    pool.magnitude = magnitude;
    pool.minPaymentSatoshis = (processingConfig.minimumPayment || 0) * magnitude;

    pool.feePerByte = feePerByte;

    logger.debug(logSystem, logComponent, `Payment: Updated fee rate to ${feePerByte} sat per vb`);
}

class PaymentProcessor {
    constructor(logger, portalConfig, poolOptions) {
        const coin = poolOptions.coin.name;
        const processingConfig = poolOptions.paymentProcessing;
        const logSystem = 'Payments';
        const logComponent = coin;

        const daemon = new Stratum.daemon.interface([processingConfig.daemon], function(severity, message){
            logger[severity](logSystem, logComponent, message);
        });
        const redisClient = redis.createClient(poolOptions.redis.port, poolOptions.redis.host);

        const daemonAsync = new DaemonAsync(processingConfig.daemon);

        this.logger = logger;
        this.poolOptions = poolOptions;
        this.poolAddress = poolOptions.address;

        this.coin = coin;
        this.processingConfig = processingConfig;
        this.logSystem = logSystem;
        this.logComponent = logComponent;

        this.pplntEnabled = processingConfig.paymentMode === 'pplnt' || false;
        this.pplntTimeQualify = processingConfig.pplnt || 0.51; // 51%

        this.daemon = daemon;
        this.redisClient = redisClient;

        this.daemonAsync = daemonAsync;

        this.historicalRetention = portalConfig.website.stats.historicalRetention;

        this.SetupForPool();
    }

    async SetupForPool() {
        try {
            const { logger, logSystem, logComponent, processingConfig, poolOptions, pplntEnabled, pplntTimeQualify } = this;

            await Promise.all([
                validateAddress(this),
                getDecimals(this)
            ]);

            processPayments(this).then(() => {
                this.paymentInterval = setInterval(async () => {
                    try {
                        await getDecimals(this);
                        await processPayments(this);
                    } catch (error) {
                        console.log(error);
                    }
                }, processingConfig.paymentInterval * 1000);
            });

            logger.debug(logSystem, logComponent, 'Payment processing setup to run every '
                + processingConfig.paymentInterval + ' second(s) with daemon ('
                + processingConfig.daemon.user + '@' + processingConfig.daemon.host + ':' + processingConfig.daemon.port
                + ') and redis (' + poolOptions.redis.host + ':' + poolOptions.redis.port + ')'
                + `${pplntEnabled ? ` and PPLNT enabled (${pplntTimeQualify * 100}%)` : ''}`
            );
        } catch (err) {
            console.log(err);
        }
    }
}

class PaymentProcessorFactory {
    constructor(logger) {
        const poolConfigs = JSON.parse(process.env.pools);
        const portalConfig = JSON.parse(process.env.portalConfig);

        const enabledPools = Object.keys(poolConfigs).reduce((acc, coin) => {
            const poolOptions = poolConfigs[coin];

            if (poolOptions.paymentProcessing?.enabled) {
                acc.push(coin);
            }

            return acc;
        }, []);

        enabledPools.forEach(coin => {
            new PaymentProcessor(logger, portalConfig, poolConfigs[coin]);
        });
    }
}

module.exports = PaymentProcessorFactory;

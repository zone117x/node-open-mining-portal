var redis = require('redis');
var async = require('async');

var Stratum = require('stratum-pool');



module.exports = function(logger){

    var poolConfigs = JSON.parse(process.env.pools);

    var enabledPools = [];

    Object.keys(poolConfigs).forEach(function(coin) {
        var poolOptions = poolConfigs[coin];
        if (poolOptions.shareProcessing &&
            poolOptions.shareProcessing.internal &&
            poolOptions.shareProcessing.internal.enabled)
            enabledPools.push(coin);
    });

    async.filter(enabledPools, function(coin, callback){
        SetupForPool(logger, poolConfigs[coin], function(setupResults){
            callback(setupResults);
        });
    }, function(coins){
        coins.forEach(function(coin){

            var poolOptions = poolConfigs[coin];
            var processingConfig = poolOptions.shareProcessing.internal;
            var logSystem = 'Payments';
            var logComponent = coin;

            logger.debug(logSystem, logComponent, 'Payment processing setup to run every '
                + processingConfig.paymentInterval + ' second(s) with daemon ('
                + processingConfig.daemon.user + '@' + processingConfig.daemon.host + ':' + processingConfig.daemon.port
                + ') and redis (' + processingConfig.redis.host + ':' + processingConfig.redis.port + ')');

        });
    });


};


function SetupForPool(logger, poolOptions, setupFinished){


    var coin = poolOptions.coin.name;
    var processingConfig = poolOptions.shareProcessing.internal;

    var logSystem = 'Payments';
    var logComponent = coin;

    var processingPayments = true;

    var daemon;
    var redisClient;

    async.parallel([

        function(callback){
            daemon = new Stratum.daemon.interface([processingConfig.daemon]);
            daemon.once('online', function(){
                daemon.cmd('validateaddress', [poolOptions.address], function(result){
                    if (!result[0].response || !result[0].response.ismine){
                        logger.error(logSystem, logComponent,
                            'Daemon does not own pool address - payment processing can not be done with this daemon, '
                         + JSON.stringify(result[0].response));
                        return;
                    }
                    callback()
                });
            }).once('connectionFailed', function(error){
                logger.error(logSystem, logComponent, 'Failed to connect to daemon for payment processing: config ' +
                    JSON.stringify(processingConfig.daemon) + ', error: ' +
                    JSON.stringify(error));
                callback('Error connecting to deamon');
            }).on('error', function(error){
                logger.error(logSystem, logComponent, 'Daemon error ' + JSON.stringify(error));
            }).init();
        },
        function(callback){

            redisClient = redis.createClient(processingConfig.redis.port, processingConfig.redis.host);
            redisClient.on('ready', function(){
                if (callback) {
                    callback();
                    callback = null;
                    return;
                }
                logger.debug(logSystem, logComponent, 'Connected to redis at '
                    + processingConfig.redis.host + ':' + processingConfig.redis.port + ' for payment processing');
            }).on('end', function(){
                logger.error(logSystem, logComponent, 'Connection to redis database as been ended');
            }).once('error', function(){
                if (callback) {
                    logger.error(logSystem, logComponent, 'Failed to connect to redis at '
                        + processingConfig.redis.host + ':' + processingConfig.redis.port + ' for payment processing');
                    callback('Error connecting to redis');
                    callback = null;
                }
            });

        }
    ], function(err){
        if (err){
            setupFinished(false);
            return;
        }
        setInterval(function(){
            try {
                processPayments();
            } catch(e){
                throw e;
            }
        }, processingConfig.paymentInterval * 1000);
        setTimeout(processPayments, 100);
        setupFinished(true);
    });


    /* Call redis to check if previous sendmany and/or redis cleanout commands completed successfully.
    If sendmany worked fine but redis commands failed you HAVE TO run redis commands again 
    (manually) to prevent double payments. If sendmany failed too you can safely delete 
    coin + '_finalRedisCommands' string from redis to let pool calculate payments again. */
    function checkPreviousPaymentsStatus(callback) {
        redisClient.get(coin + '_finalRedisCommands', function(error, reply) {
            if (error){
                callback('Could not get finalRedisCommands - ' + JSON.stringify(error));
                return;
            }
            if (reply) {
                callback('Payments stopped because of the critical error - failed commands saved in '
                    + coin + '_finalRedisCommands redis set:\n' + reply);
                return;
            } else {
                /* There was no error in previous sendmany and/or redis cleanout commands
                so we can safely continue */
                processingPayments = false;
                callback();
            }
        });
    }


    /* Number.toFixed gives us the decimal places we want, but as a string. parseFloat turns it back into number
       we don't care about trailing zeros in this case. */
    var toPrecision = function(value, precision){
        return parseFloat(value.toFixed(precision));
    };


    /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
       when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */

    var processPayments = function(){


        var startPaymentProcess = Date.now();

        async.waterfall([

            function(callback) {
                if (processingPayments) {
                    checkPreviousPaymentsStatus(function(error){
                        if (error) {
                            logger.error(logSystem, logComponent, error);
                            callback('Check finished - previous payments processing error');
                            return;
                        }
                        callback();
                    });
                    return;
                }
                callback();
            },

            /* Call redis to get an array of rounds - which are coinbase transactions and block heights from submitted
               blocks. */
            function(callback){

                redisClient.smembers(coin + '_blocksPending', function(error, results){

                    if (error){
                        logger.error(logSystem, logComponent, 'Could not get blocks from redis ' + JSON.stringify(error));
                        callback('Check finished - redis error for getting blocks');
                        return;
                    }
                    if (results.length === 0){
                        callback('Check finished - no pending blocks in redis');
                        return;
                    }

                    var rounds = results.map(function(r){
                        var details = r.split(':');
                        return {
                            category: details[0].category,
                            blockHash: details[0],
                            txHash: details[1],
                            height: details[2],
                            reward: details[3],
                            serialized: r
                        };
                    });

                    callback(null, rounds);
                });
            },

            /* Does a batch rpc call to daemon with all the transaction hashes to see if they are confirmed yet.
               It also adds the block reward amount to the round object - which the daemon gives also gives us. */
            function(rounds, callback){

                var batchRPCcommand = rounds.map(function(r){
                    return ['gettransaction', [r.txHash]];
                });

                daemon.batchCmd(batchRPCcommand, function(error, txDetails){

                    if (error || !txDetails){
                        callback('Check finished - daemon rpc error with batch gettransactions ' +
                            JSON.stringify(error));
                        return;
                    }

                    txDetails.forEach(function(tx, i){
                        var round = rounds[i];

                        if (tx.error && tx.error.code === -5 || round.blockHash !== tx.result.blockhash){

                            /* Block was dropped from coin daemon even after it happily accepted it earlier. */

                            //If we find another block at the same height then this block was drop-kicked orphaned
                            var dropKicked = rounds.filter(function(r){
                                return r.height === round.height && r.blockHash !== round.blockHash && r.category !== 'dropkicked';
                            }).length > 0;

                            if (dropKicked){
                                logger.warning(logSystem, logComponent,
                                        'A block was drop-kicked orphaned'
                                        + ' - we found a better block at the same height, blockHash '
                                        + round.blockHash + " round " + round.height);
                                round.category = 'dropkicked';
                            }
                            else{
                                /* We have no other blocks that match this height so convert to orphan in order for
                                   shares from the round to be rewarded. */
                                round.category = 'orphan';
                            }
                        }
                        else if (tx.error || !tx.result){
                            logger.error(logSystem, logComponent,
                                    'Error with requesting transaction from block daemon: ' + JSON.stringify(tx));
                        }
                        else{
                            round.category = tx.result.details[0].category;
                            if (round.category === 'generate')
                                round.amount = tx.result.amount;
                        }
                    });


                    var magnitude;

                    //Filter out all rounds that are immature (not confirmed or orphaned yet)
                    rounds = rounds.filter(function(r){
                        switch (r.category) {

                            case 'generate':
                                /* Here we calculate the smallest unit in this coin's currency; the 'satoshi'.
                                 The rpc.getblocktemplate.amount tells us how much we get in satoshis, while the
                                 rpc.gettransaction.amount tells us how much we get in whole coin units. Therefore,
                                 we simply divide the two to get the magnitude. I don't know math, there is probably
                                 a better term than 'magnitude'. Sue me or do a pull request to fix it. */
                                var roundMagnitude = r.reward / r.amount;

                                if (!magnitude) {
                                    magnitude = roundMagnitude;

                                    if (roundMagnitude % 10 !== 0)
                                        logger.error(logSystem, logComponent,
                                            'Satosihis in coin is not divisible by 10 which is very odd');
                                }
                                else if (magnitude != roundMagnitude) {
                                    /* Magnitude for a coin should ALWAYS be the same. For BTC and most coins there are
                                     100,000,000 satoshis in one coin unit. */
                                    logger.error(logSystem, logComponent,
                                        'Magnitude in a round was different than in another round. HUGE PROBLEM.');
                                }
                                return true;

                            case 'dropkicked':
                            case 'orphan':
                                return true;
                            default:
                                return false;
                        }
                    });


                    if (rounds.length === 0){
                        callback('Check finished - no confirmed or orphaned blocks found');
                    }
                    else{
                        callback(null, rounds, magnitude);
                    }
                });
            },


            /* Does a batch redis call to get shares contributed to each round. Then calculates the reward
               amount owned to each miner for each round. */
            function(rounds, magnitude, callback){


                var shareLookups = rounds.map(function(r){
                    return ['hgetall', coin + '_shares:round' + r.height]
                });


                redisClient.multi(shareLookups).exec(function(error, allWorkerShares){
                    if (error){
                        callback('Check finished - redis error with multi get rounds share')
                        return;
                    }

                    var orphanMergeCommands = [];
                    var workerRewards = {};


                    rounds.forEach(function(round, i){
                        var workerShares = allWorkerShares[i];

                        if (!workerShares){
                            logger.error(logSystem, logComponent, 'No worker shares for round: '
                                + round.height + ' blockHash: ' + round.blockHash);
                            return;
                        }

                        switch (round.category){
                            case 'orphan':
                                /* Each block that gets orphaned, all the shares go into the current round so that
                                   miners still get a reward for their work. This seems unfair to those that just
                                   started mining during this current round, but over time it balances out and rewards
                                   loyal miners. */
                                Object.keys(workerShares).forEach(function(worker){
                                    orphanMergeCommands.push(['hincrby', coin + '_shares:roundCurrent',
                                        worker, workerShares[worker]]);
                                });
                                break;

                            case 'generate':
                                /* We found a confirmed block! Now get the reward for it and calculate how much
                                   we owe each miner based on the shares they submitted during that block round. */
                                var reward = round.reward * (1 - processingConfig.feePercent);

                                var totalShares = Object.keys(workerShares).reduce(function(p, c){
                                    return p + parseInt(workerShares[c])
                                }, 0);

                                for (var worker in workerShares){
                                    var percent = parseInt(workerShares[worker]) / totalShares;
                                    var workerRewardTotal = Math.floor(reward * percent);
                                    if (!(worker in workerRewards)) workerRewards[worker] = 0;
                                    workerRewards[worker] += workerRewardTotal;
                                }
                                break;
                        }

                    });

                    callback(null, rounds, magnitude, workerRewards, orphanMergeCommands);
                });
            },


            /* Does a batch call to redis to get worker existing balances from coin_balances*/
            function(rounds, magnitude, workerRewards, orphanMergeCommands, callback){

                var workers = Object.keys(workerRewards);

                redisClient.hmget([coin + '_balances'].concat(workers), function(error, results){
                    if (error && workers.length !== 0){
                        callback('Check finished - redis error with multi get balances ' + JSON.stringify(error));
                        return;
                    }


                    var workerBalances = {};

                    for (var i = 0; i < workers.length; i++){
                        workerBalances[workers[i]] = (parseInt(results[i]) || 0);
                    }


                    callback(null, rounds, magnitude, workerRewards, orphanMergeCommands, workerBalances);
                });

            },


            /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
            function(rounds, magnitude, workerRewards, orphanMergeCommands, workerBalances, callback){

                //number of satoshis in a single coin unit - this can be different for coins so we calculate it :)


                daemon.cmd('getbalance', [''], function(results){

                    var totalBalance = results[0].response * magnitude;
                    var toBePaid = 0;
                    var workerPayments = {};


                    var balanceUpdateCommands = [];
                    var workerPayoutsCommand = [];

                    /* Here we add up all workers' previous unpaid balances plus their current rewards as we are
                       about to check if they reach the payout threshold. */
                    for (var worker in workerRewards){
                        workerPayments[worker] = ((workerPayments[worker] || 0) + workerRewards[worker]);
                    }
                    for (var worker in workerBalances){
                        workerPayments[worker] = ((workerPayments[worker] || 0) + workerBalances[worker]);
                    }

                    /* Here we check if any of the workers reached their payout threshold, or delete them from the
                       pending payment ledger (the workerPayments object). */
                    if (Object.keys(workerPayments).length > 0){
                        var coinPrecision = magnitude.toString().length - 1;
                        for (var worker in workerPayments){
                            if (workerPayments[worker] < processingConfig.minimumPayment * magnitude){
                                /* The workers total earnings (balance + current reward) was not enough to warrant
                                   a transaction, so we will store their balance in the database. Next time they
                                   are rewarded it might reach the payout threshold. */
                                balanceUpdateCommands.push([
                                    'hincrby',
                                    coin + '_balances',
                                    worker,
                                    workerRewards[worker]
                                ]);
                                delete workerPayments[worker];
                            }
                            else{
                                //If worker had a balance that is about to be paid out, subtract it from the database
                                if (workerBalances[worker] !== 0){
                                    balanceUpdateCommands.push([
                                        'hincrby',
                                        coin + '_balances',
                                        worker,
                                        -1 * workerBalances[worker]
                                    ]);
                                }
                                var rewardInPrecision = (workerRewards[worker] / magnitude).toFixed(coinPrecision);
                                workerPayoutsCommand.push(['hincrbyfloat', coin + '_payouts', worker, rewardInPrecision]);
                                toBePaid += workerPayments[worker];
                            }
                        }

                    }

                    // txfee included in feeAmountToBeCollected
                    var leftOver = toBePaid / (1 - processingConfig.feePercent);
                    var feeAmountToBeCollected = toPrecision(leftOver * processingConfig.feePercent, coinPrecision);
                    var balanceLeftOver = totalBalance - toBePaid - feeAmountToBeCollected;
                    var minReserveSatoshis = processingConfig.minimumReserve * magnitude;
                    if (balanceLeftOver < minReserveSatoshis){
                        /* TODO: Need to convert all these variables into whole coin units before displaying because
                           humans aren't good at reading satoshi units. */
                        callback('Check finished - payments would wipe out minimum reserve, tried to pay out ' +
                            toBePaid + ' and collect ' + feeAmountToBeCollected + ' as fees' +
                            ' but only have ' + totalBalance + '. Left over balance would be ' + balanceLeftOver +
                            ', needs to be at least ' + minReserveSatoshis);
                        return;
                    }


                    /* Move pending blocks into either orphan for confirmed sets, and delete their no longer
                       required round/shares data. */
                    var movePendingCommands = [];
                    var roundsToDelete = [];
                    rounds.forEach(function(r){

                        var destinationSet = (function(){
                            switch(r.category){
                                case 'orphan': return '_blocksOrphaned';
                                case 'generate': return '_blocksConfirmed';
                                case 'dropkicked': return '_blocksDropKicked';
                            }
                        })();
                        movePendingCommands.push(['smove', coin + '_blocksPending', coin + destinationSet, r.serialized]);
                        roundsToDelete.push(coin + '_shares:round' + r.height)
                    });

                    var finalRedisCommands = [];

                    if (movePendingCommands.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(movePendingCommands);

                    if (orphanMergeCommands.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(orphanMergeCommands);

                    if (balanceUpdateCommands.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(balanceUpdateCommands);

                    if (workerPayoutsCommand.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(workerPayoutsCommand);

                    if (roundsToDelete.length > 0)
                        finalRedisCommands.push(['del'].concat(roundsToDelete));

                    if (toBePaid !== 0)
                        finalRedisCommands.push(['hincrbyfloat', coin + '_stats', 'totalPaid', (toBePaid / magnitude).toFixed(coinPrecision)]);

                    finalRedisCommands.push(['del', coin + '_finalRedisCommands']);

                    finalRedisCommands.push(['bgsave']);

                    callback(null, magnitude, workerPayments, finalRedisCommands);

                });
            },

            function(magnitude, workerPayments, finalRedisCommands, callback) {
                /* Save final redis cleanout commands in case something goes wrong during payments */
                redisClient.set(coin + '_finalRedisCommands', JSON.stringify(finalRedisCommands), function(error, reply) {
                    if (error){
                        callback('Check finished - error with saving finalRedisCommands' + JSON.stringify(error));
                        return;
                    }
                    callback(null, magnitude, workerPayments, finalRedisCommands);
                });
            },

            function(magnitude, workerPayments, finalRedisCommands, callback){

                //This does the final all-or-nothing atom transaction if block deamon sent payments
                var finalizeRedisTx = function(){
                    redisClient.multi(finalRedisCommands).exec(function(error, results){
                        if (error){
                            callback('Error with final redis commands for cleaning up ' + JSON.stringify(error));
                            return;
                        }
                        processingPayments = false;
                        logger.debug(logSystem, logComponent, 'Payments processing performed an interval');
                    });
                };

                if (Object.keys(workerPayments).length === 0){
                    finalizeRedisTx();
                }
                else{

                    //This is how many decimal places to round a coin down to
                    var coinPrecision = magnitude.toString().length - 1;
                    var addressAmounts = {};
                    var totalAmountUnits = 0;
                    for (var address in workerPayments){
                        var coinUnits = toPrecision(workerPayments[address] / magnitude, coinPrecision);
                        addressAmounts[address] = coinUnits;
                        totalAmountUnits += coinUnits;
                    }

                    logger.debug(logSystem, logComponent, 'Payments to be sent to: ' + JSON.stringify(addressAmounts));

                    processingPayments = true;
                    daemon.cmd('sendmany', ['', addressAmounts], function(results){

                        if (results[0].error){
                            callback('Check finished - error with sendmany ' + JSON.stringify(results[0].error));
                            return;
                        }

                        finalizeRedisTx();

                        var totalWorkers = Object.keys(workerPayments).length;

                        logger.debug(logSystem, logComponent, 'Payments sent, a total of ' + totalAmountUnits
                            + ' ' + poolOptions.coin.symbol + ' was sent to ' + totalWorkers + ' miners');

                        daemon.cmd('gettransaction', [results[0].response], function(results){
                            if (results[0].error){
                                callback('Check finished - error with gettransaction ' + JSON.stringify(results[0].error));
                                return;
                            }
                            var feeAmountUnits = parseFloat((totalAmountUnits / (1 - processingConfig.feePercent) * processingConfig.feePercent).toFixed(coinPrecision));
                            var poolFees = feeAmountUnits - results[0].response.fee;
                            daemon.cmd('move', ['', processingConfig.feeCollectAccount, poolFees], function(results){
                                if (results[0].error){
                                    callback('Check finished - error with move ' + JSON.stringify(results[0].error));
                                    return;
                                }
                                callback(null, poolFees + ' ' + poolOptions.coin.symbol + ' collected as pool fee');
                            });
                        });
                    });
                }
            }
        ], function(error, result){


            var paymentProcessTime = Date.now() - startPaymentProcess;

            if (error)
                logger.debug(logSystem, logComponent, '[Took ' + paymentProcessTime + 'ms] ' + error);

            else{
                logger.debug(logSystem, logComponent, '[' + paymentProcessTime + 'ms] ' + result);
                // not sure if we need some time to let daemon update the wallet balance
                setTimeout(withdrawalProfit, 1000);
            }
        });
    };


    var withdrawalProfit = function(){

        if (!processingConfig.feeWithdrawalThreshold) return;

        logger.debug(logSystem, logComponent, 'Profit withdrawal started');
        daemon.cmd('getbalance', [processingConfig.feeCollectAccount], function(results){

            // We have to pay some tx fee here too but maybe we shoudn't really care about it too much as long as fee is less 
            // then minimumReserve value. Because in this case even if feeCollectAccount account will have negative balance
            // total wallet balance will be positive and feeCollectAccount account will be refilled during next payment processing.
            var withdrawalAmount = results[0].response;

            if (withdrawalAmount < processingConfig.feeWithdrawalThreshold){
                logger.debug(logSystem, logComponent, 'Not enough profit to withdraw yet');
            }
            else{

                var withdrawal = {};
                withdrawal[processingConfig.feeReceiveAddress] = withdrawalAmount;

                daemon.cmd('sendmany', [processingConfig.feeCollectAccount, withdrawal], function(results){
                    if (results[0].error){
                        logger.debug(logSystem, logComponent, 'Profit withdrawal finished - error with sendmany '
                            + JSON.stringify(results[0].error));
                        return;
                    }
                    logger.debug(logSystem, logComponent, 'Profit sent, a total of ' + withdrawalAmount
                        + ' ' + poolOptions.coin.symbol + ' was sent to ' + processingConfig.feeReceiveAddress);
                });
            }
        });

    };

};
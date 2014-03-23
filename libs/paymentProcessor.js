var redis = require('redis');
var async = require('async');

var Stratum = require('stratum-pool');



module.exports = function(logger){

    var poolConfigs = JSON.parse(process.env.pools);


    Object.keys(poolConfigs).forEach(function(coin) {
        SetupForPool(logger, poolConfigs[coin]);
    });

};


function SetupForPool(logger, poolOptions){

    var coin = poolOptions.coin.name;

    var processingConfig = poolOptions.shareProcessing.internal;

    if (!processingConfig.enabled) return;

    var logIdentify = 'Payment Processor (' + coin + ')';

    var paymentLogger = {
        debug: function(key, text){
            logger.logDebug(logIdentify, key, text);
        },
        warning: function(key, text){
            logger.logWarning(logIdentify, key, text);
        },
        error: function(key, text){
            logger.logError(logIdentify, key, text);
        }
    };

    var daemon = new Stratum.daemon.interface([processingConfig.daemon]);
    daemon.once('online', function(){
        paymentLogger.debug('system', 'Connected to daemon for payment processing');

        daemon.cmd('validateaddress', [poolOptions.address], function(result){
            if (!result[0].response.ismine){
                paymentLogger.error('system', 'Daemon does not own pool address - payment processing can not be done with this daemon');
            }
        });
    }).once('connectionFailed', function(error){
        paymentLogger.error('system', 'Failed to connect to daemon for payment processing: ' + JSON.stringify(error));
    }).on('error', function(error){
        paymentLogger.error('system', error);
    }).init();



    var redisClient;


    var connectToRedis = function(){
        var reconnectTimeout;
        redisClient = redis.createClient(processingConfig.redis.port, processingConfig.redis.host);
        redisClient.on('ready', function(){
            clearTimeout(reconnectTimeout);
            paymentLogger.debug('redis', 'Successfully connected to redis database');
        }).on('error', function(err){
                paymentLogger.error('redis', 'Redis client had an error: ' + JSON.stringify(err))
        }).on('end', function(){
            paymentLogger.error('redis', 'Connection to redis database as been ended');
            paymentLogger.warning('redis', 'Trying reconnection in 3 seconds...');
            reconnectTimeout = setTimeout(function(){
                connectToRedis();
            }, 3000);
        });
    };
    connectToRedis();



    var processPayments = function(){
        async.waterfall([

            /* Call redis to get an array of rounds - which are coinbase transactions and block heights from submitted
               blocks. */
            function(callback){

                redisClient.smembers(coin + '_blocksPending', function(error, results){

                    if (error){
                        paymentLogger.error('redis', 'Could get blocks from redis ' + JSON.stringify(error));
                        callback('done - redis error for getting blocks');
                        return;
                    }
                    if (results.length === 0){
                        callback('done - no pending blocks in redis');
                        return;
                    }

                    var rounds = results.map(function(r){
                        var details = r.split(':');
                        return {
                            category: details[0].category,
                            txHash: details[0],
                            height: details[1],
                            reward: details[2],
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
                        callback('done - daemon rpc error with batch gettransactions ' + JSON.stringify(error));
                        return;
                    }

                    txDetails = txDetails.filter(function(tx){
                        if (tx.error || !tx.result){
                            paymentLogger.error('error with requesting transaction from block daemon: ' + JSON.stringify(t));
                            return false;
                        }
                        return true;
                    });


                    var magnitude;

                    rounds = rounds.filter(function(r){
                        var tx = txDetails.filter(function(tx){return tx.result.txid === r.txHash})[0];

                        if (!tx){
                            paymentLogger.error('system', 'daemon did not give us back a transaction that we asked for: ' + r.txHash);
                            return;
                        }

                        r.category = tx.result.details[0].category;

                        if (r.category === 'generate'){
                            r.amount = tx.result.amount;

                            var roundMagnitude = r.reward / r.amount;
                            if (!magnitude){
                                magnitude = roundMagnitude;

                                if (roundMagnitude % 10 !== 0)
                                    paymentLogger.error('system', 'Satosihis in coin is not divisible by 10 which is very odd');
                            }
                            else if (magnitude != roundMagnitude){
                                paymentLogger.error('system', 'Magnitude in a round was different than in another round. HUGE PROBLEM.');
                            }
                            return true;
                        }
                        else if (r.category === 'orphan')
                            return true;

                    });


                    if (rounds.length === 0){
                        callback('done - no confirmed or orphaned rounds');
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
                        callback('done - redis error with multi get rounds share')
                        return;
                    }

                    var orphanMergeCommands = [];
                    var workerRewards = {};


                    rounds.forEach(function(round, i){
                        var workerShares = allWorkerShares[i];

                        if (round.category === 'orphan'){
                            Object.keys(workerShares).forEach(function(worker){
                                orphanMergeCommands.push(['hincrby', coin + '_shares:roundCurrent', worker, workerShares[worker]]);
                            });
                        }
                        else if (round.category === 'generate'){

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
                        callback('done - redis error with multi get balances ' + JSON.stringify(error));
                        return;
                    }


                    var workerBalances = {};

                    for (var i = 0; i < workers.length; i++){
                        workerBalances[workers[i]] = (parseInt(results[i]) || 0) * magnitude;
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


                daemon.cmd('getbalance', [], function(results){

                    var totalBalance = results[0].response * magnitude;
                    var toBePaid = 0;
                    var workerPayments = {};


                    var balanceUpdateCommands = [];
                    var workerPayoutsCommand = [];

                    for (var worker in workerRewards){
                        workerPayments[worker] = ((workerPayments[worker] || 0) + workerRewards[worker]);
                    }
                    for (var worker in workerBalances){
                        workerPayments[worker] = ((workerPayments[worker] || 0) + workerBalances[worker]);
                    }

                    if (Object.keys(workerPayments).length > 0){
                        var coinPrecision = magnitude.toString().length - 1;
                        for (var worker in workerPayments){
                            if (workerPayments[worker] < processingConfig.minimumPayment * magnitude){
                                balanceUpdateCommands.push(['hincrby', coin + '_balances', worker, workerRewards[worker]]);
                                delete workerPayments[worker];
                            }
                            else{
                                if (workerBalances[worker] !== 0){
                                    balanceUpdateCommands.push(['hincrby', coin + '_balances', worker, -1 * workerBalances[worker]]);
                                }
                                var rewardInPrecision = (workerRewards[worker] / magnitude).toFixed(coinPrecision);
                                workerPayoutsCommand.push(['hincrbyfloat', coin + '_payouts', worker, rewardInPrecision]);
                                toBePaid += workerPayments[worker];
                            }
                        }

                    }

                    var balanceLeftOver = totalBalance - toBePaid;
                    var minReserveSatoshis = processingConfig.minimumReserve * magnitude;
                    if (balanceLeftOver < minReserveSatoshis){

                        callback('done - payments would wipe out minimum reserve, tried to pay out ' + toBePaid +
                            ' but only have ' + totalBalance + '. Left over balance would be ' + balanceLeftOver +
                            ', needs to be at least ' + minReserveSatoshis);
                        return;
                    }


                    var movePendingCommands = [];
                    var roundsToDelete = [];
                    rounds.forEach(function(r){
                        var destinationSet = r.category === 'orphan' ? '_blocksOrphaned' : '_blocksConfirmed';
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


                    callback(null, magnitude, workerPayments, finalRedisCommands);


                });
            },

            function(magnitude, workerPayments, finalRedisCommands, callback){


                //This does the final all-or-nothing atom transaction if block deamon sent payments
                var finalizeRedisTx = function(){
                    redisClient.multi(finalRedisCommands).exec(function(error, results){
                        if (error){
                            callback('done - error with final redis commands for cleaning up ' + JSON.stringify(error));
                            return;
                        }
                        callback(null, 'Payments processing performed an interval');
                    });
                };

                if (Object.keys(workerPayments).length === 0){
                    finalizeRedisTx();
                }
                else{


                    var coinPrecision = magnitude.toString().length - 1;
                    var addressAmounts = {};
                    for (var address in workerPayments){
                        addressAmounts[address] = parseFloat((workerPayments[address] / magnitude).toFixed(coinPrecision));
                    }

                    paymentLogger.debug('system', 'Payments about to be sent to: ' + JSON.stringify(addressAmounts));
                    daemon.cmd('sendmany', ['', addressAmounts], function(results){
                        if (results[0].error){
                            callback('done - error with sendmany ' + JSON.stringify(results[0].error));
                            return;
                        }
                        finalizeRedisTx();
                        var totalWorkers = Object.keys(workerPayments).length;
                        var totalAmount = Object.keys(workerPayments).reduce(function(p, c){return p + workerPayments[c]}, 0);
                        paymentLogger.debug('system', 'Payments sent, a total of ' + totalAmount +
                            ' was sent to ' + totalWorkers + ' miners');
                    });
                }



            }
        ], function(error, result){
            if (error)
                paymentLogger.debug('system', error)

            else{
                paymentLogger.debug('system', result);
                withdrawalProfit();
            }
        });
    };


    var withdrawalProfit = function(){

        if (!processingConfig.feeWithdrawalThreshold) return;

        daemon.cmd('getbalance', [], function(results){

            var totalBalance = results[0].response;
            var withdrawalAmount = totalBalance - processingConfig.minimumReserve;
            var leftOverBalance = totalBalance - withdrawalAmount;


            if (leftOverBalance < processingConfig.minimumReserve || withdrawalAmount < processingConfig.feeWithdrawalThreshold){
                paymentLogger.debug('system', 'Not enough profit to withdrawal yet');
            }
            else{
                //Need to figure out how much of the balance is profit... ???
                paymentLogger.debug('system', 'Can send profit');
            }

        });

    };


    setInterval(processPayments, processingConfig.paymentInterval * 1000);
    setTimeout(processPayments, 100);

};
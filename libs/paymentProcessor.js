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
                        logger.error('redis', 'Could get blocks from redis ' + JSON.stringify(error));
                        callback('done - redis error for getting blocks');
                        return;
                    }
                    if (results.length === 0){
                        callback('done - no pending blocks in redis');
                        return;
                    }

                    var rounds = results.map(function(r){
                        var details = r.split(':');
                        return {txHash: details[0], height: details[1], reward: details[2], serialized: r};
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
                            console.log('error with requesting transaction from block daemon: ' + JSON.stringify(t));
                            return false;
                        }
                        return true;
                    });

                    var orphanedRounds = [];
                    var confirmedRounds = [];
                    //Rounds that are not confirmed yet are removed from the round array
                    //We also get reward amount for each block from daemon reply
                    rounds.forEach(function(r){

                        var tx = txDetails.filter(function(tx){return tx.result.txid === r.txHash})[0];

                        if (!tx){
                            console.log('daemon did not give us back a transaction that we asked for: ' + r.txHash);
                            return;
                        }


                        r.category = tx.result.details[0].category;

                        if (r.category === 'orphan'){
                            orphanedRounds.push(r);

                        }
                        else if (r.category === 'generate'){
                            r.amount = tx.result.amount;
                            r.magnitude = r.reward / r.amount;
                            confirmedRounds.push(r);
                        }

                    });

                    if (orphanedRounds.length === 0 && confirmedRounds.length === 0){
                        callback('done - no confirmed or orhpaned rounds');
                    }
                    else{
                        callback(null, confirmedRounds, orphanedRounds);
                    }
                });
            },


            /* Does a batch redis call to get shares contributed to each round. Then calculates the reward
               amount owned to each miner for each round. */
            function(confirmedRounds, orphanedRounds, callback){


                var rounds = [];
                for (var i = 0; i < orphanedRounds.length; i++) rounds.push(orphanedRounds[i]);
                for (var i = 0; i < confirmedRounds.length; i++) rounds.push(confirmedRounds[i]);


                var shareLookups = rounds.map(function(r){
                    return ['hgetall', coin + '_shares:round' + r.height]
                });

                redisClient.multi(shareLookups).exec(function(error, allWorkerShares){
                    if (error){
                        callback('done - redis error with multi get rounds share')
                        return;
                    }


                    // Iterate through the beginning of the share results which are for the orphaned rounds
                    var orphanMergeCommands = []
                    for (var i = 0; i < orphanedRounds.length; i++){
                        var workerShares = allWorkerShares[i];
                        Object.keys(workerShares).forEach(function(worker){
                            orphanMergeCommands.push(['hincrby', coin + '_shares:roundCurrent', worker, workerShares[worker]]);
                        });
                        orphanMergeCommands.push([]);
                    }

                    // Iterate through the rest of the share results which are for the worker rewards
                    var workerRewards = {};
                    for (var i = orphanedRounds.length; i < allWorkerShares.length; i++){

                        var round = rounds[i];
                        var workerShares = allWorkerShares[i];

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


                    //this calculates profit if you wanna see it
                    /*
                    var workerTotalRewards = Object.keys(workerRewards).reduce(function(p, c){
                        return p + workerRewards[c];
                    }, 0);

                    var poolTotalRewards = rounds.reduce(function(p, c){
                        return p + c.amount * c.magnitude;
                    }, 0);

                    console.log(workerRewards);
                    console.log('pool profit percent' + ((poolTotalRewards - workerTotalRewards) / poolTotalRewards));
                    */

                    callback(null, rounds, workerRewards, orphanMergeCommands);
                });
            },


            /* Does a batch call to redis to get worker existing balances from coin_balances*/
            function(rounds, workerRewards, orphanMergeCommands, callback){

                var workers = Object.keys(workerRewards);

                redisClient.hmget([coin + '_balances'].concat(workers), function(error, results){
                    if (error){
                        callback('done - redis error with multi get balances');
                        return;
                    }


                    var workerBalances = {};

                    for (var i = 0; i < workers.length; i++){
                        workerBalances[workers[i]] = parseInt(results[i]) || 0;
                    }


                    callback(null, rounds, workerRewards, workerBalances, orphanMergeCommands);
                });

            },


            /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
            function(rounds, workerRewards, workerBalances, orphanMergeCommands, callback){

                var magnitude = rounds[0].magnitude;

                daemon.cmd('getbalance', [], function(results){

                    var totalBalance = results[0].response * magnitude;
                    var toBePaid = 0;
                    var workerPayments = {};


                    var balanceUpdateCommands = [];
                    var workerPayoutsCommand = [];

                    for (var worker in workerRewards){
                        workerPayments[worker] = (workerPayments[worker] || 0) + workerRewards[worker];
                    }
                    for (var worker in workerBalances){
                        workerPayments[worker] = (workerPayments[worker] || 0) + workerBalances[worker];
                    }
                    for (var worker in workerPayments){
                        if (workerPayments[worker] < processingConfig.minimumPayment * magnitude){
                            balanceUpdateCommands.push(['hincrby', coin + '_balances', worker, workerRewards[worker]]);
                            delete workerPayments[worker];
                        }
                        else{
                            if (workerBalances[worker] !== 0)
                                balanceUpdateCommands.push(['hincrby', coin + '_balances', worker, -1 * workerBalances[worker]]);
                            workerPayoutsCommand.push(['hincrby', coin + '_balances', worker, workerRewards[worker]]);
                            toBePaid += workerPayments[worker];
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
                    var deleteRoundsCommand = ['del'];
                    rounds.forEach(function(r){
                        var destinationSet = r.category === 'orphan' ? '_blocksOrphaned' : '_blocksConfirmed';
                        movePendingCommands.push(['smove', coin + '_blocksPending', coin + destinationSet, r.serialized]);
                        deleteRoundsCommand.push(coin + '_shares:round' + r.height)
                    });

                    var finalRedisCommands = [];

                    finalRedisCommands = finalRedisCommands.concat(
                        movePendingCommands,
                        orphanMergeCommands,
                        balanceUpdateCommands,
                        workerPayoutsCommand
                    );

                    finalRedisCommands.push(deleteRoundsCommand);
                    finalRedisCommands.push(['hincrby', coin + '_stats', 'totalPaid', toBePaid]);


                    callback(null, magnitude, workerPayments, finalRedisCommands);



                });
            },

            function(magnitude, workerPayments, finalRedisCommands, callback){

                var sendManyCmd = ['', {}];
                for (var address in workerPayments){
                    sendManyCmd[1][address] = workerPayments[address] / magnitude;
                }

                console.log(JSON.stringify(finalRedisCommands, null, 4));
                console.log(JSON.stringify(workerPayments, null, 4));
                console.log(JSON.stringify(sendManyCmd, null, 4));

                return; //not yet...
                daemon.cmd('sendmany', sendManyCmd, function(results){
                    if (results[0].error){
                        callback('done - error with sendmany ' + JSON.stringify(results[0].error));
                        return;
                    }
                    redisClient.multi(finalRedisCommands).exec(function(error, results){
                        if (error){
                            callback('done - error with final redis commands for cleaning up ' + JSON.stringify(error));
                            return;
                        }
                        callback(null, 'Payments sent');
                    });
                });



            }
        ], function(error, result){
            if (error)
                logger.debug(error)

            else{
                logger.debug(result);
            }
        });
    };


    setInterval(processPayments, processingConfig.paymentInterval * 1000);
    setTimeout(processPayments, 100);

};
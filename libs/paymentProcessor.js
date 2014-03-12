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

                redisClient.smembers(coin + '_blocks', function(error, results){

                    if (error){
                        logger.error('redis', 'Could get blocks from redis ' + JSON.stringify(error));
                        callback('done - redis error for getting blocks');
                        return;
                    }
                    if (results.length === 0){
                        callback('done - no pending blocks in redis');
                        return;
                    }

                    var rounds = [];
                    results.forEach(function(item){
                        var details = item.split(':');
                        rounds.push({txHash: details[0], height: details[1], reward: details[2]});
                    });
                    callback(null, rounds);
                });
            },


            /* Does a batch rpc call to daemon with all the transaction hashes to see if they are confirmed yet.
               It also adds the block reward amount to the round object - which the daemon gives also gives us. */
            function(rounds, callback){

                var batchRPCcommand = [];

                for (var i = 0; i < rounds.length; i++){
                    batchRPCcommand.push(['gettransaction', [rounds[i].txHash]]);
                }
                daemon.batchCmd(batchRPCcommand, function(error, txDetails){

                    if (error || !txDetails){
                        callback('done - daemon rpc error with batch gettransactions ' + JSON.stringify(error));
                        return;
                    }

                    //Rounds that are not confirmed yet are removed from the round array
                    //We also get reward amount for each block from daemon reply
                    txDetails.forEach(function(tx){
                        var txResult = tx.result;
                        var txDetails = tx.result.details[0];
                        for (var i = 0; i < rounds.length; i++){
                            if (rounds[i].txHash === txResult.txid){
                                rounds[i].amount = txResult.amount;
                                rounds[i].magnitude = rounds[i].reward / txResult.amount;
                                if (txDetails.category !== 'generate')
                                    rounds.splice(i, 1);
                            }
                        }
                    });
                    if (rounds.length === 0){
                        callback('done - no confirmed transactions yet');
                        return;
                    }
                    callback(null, rounds);

                });
            },


            /* Does a batch redis call to get shares contributed to each round. Then calculates the reward
               amount owned to each miner for each round. */
            function(rounds, callback){

                var shareLooksup = [];
                for (var i = 0; i < rounds.length; i++){
                    shareLooksup.push(['hgetall', coin + '_shares:round' + rounds[i].height]);
                }



                redisClient.multi(shareLooksup).exec(function(error, allWorkerShares){
                    if (error){
                        callback('done - redis error with multi get rounds share')
                        return;
                    }

                    var workerRewards = {};

                    for (var i = 0; i < rounds.length; i++){
                        var round = rounds[i];
                        var workerShares = allWorkerShares[i];

                        var reward = round.reward * (1 - processingConfig.feePercent);

                        var totalShares = 0;
                        for (var worker in workerShares){
                            totalShares += parseInt(workerShares[worker]);
                        }

                        for (var worker in workerShares){
                            var singleWorkerShares = parseInt(workerShares[worker]);
                            var percent = singleWorkerShares / totalShares;
                            var workerRewardTotal = (reward * percent) / round.magnitude;
                            workerRewardTotal = Math.floor(workerRewardTotal * round.magnitude) / round.magnitude;
                            if (worker in workerRewards)
                                workerRewards[worker] += workerRewardTotal;
                            else
                                workerRewards[worker] = workerRewardTotal;
                        }
                    }


                    console.dir(workerRewards);

                    callback(null, rounds);
                });
            },


            /* Does a batch call to redis to get worker existing balances from coin_balances*/
            function(rounds, callback){
                /*
                var workerAddress = Object.keys(balancesForRounds);

                redisClient.hmget([coin + '_balances'].concat(workerAddress), function(error, results){
                    if (error){
                        callback('done - redis error with multi get rounds share')
                        return;
                    }

                    for (var i = 0; i < results.length; i++){
                        var shareInt = parseInt(results[i]);
                        if (shareInt)
                            balancesForRounds[workerAddress[i]] += shareInt;

                    }

                    callback(null, rounds, balancesForRounds)
                });
                */
            },


            /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
            function(fullBalance, rounds, callback){

                /* if payments dont succeed (likely because daemon isnt responding to rpc), then cancel here
                   so that all of this can be tried again when the daemon is working. otherwise we will consider
                   payment sent after we cleaned up the db.
                 */

            },


            /* clean DB: update remaining balances in coin_balance hashset in redis
            */
            function(balanceDifference, rounds, callback){

                //SMOVE each tx key from coin_blocks to coin_processedBlocks
                //HINCRBY to apply balance different for coin_balances worker1

            }
        ], function(error, result){
            console.log(error);
            //log error completion
        });
    };


    setInterval(processPayments, processingConfig.paymentInterval * 1000);
    setTimeout(processPayments, 100);

};
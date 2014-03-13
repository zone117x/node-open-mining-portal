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

                    var rounds = results.map(function(r){
                        var details = r.split(':');
                        return {txHash: details[0], height: details[1], reward: details[2]};
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

                    //Rounds that are not confirmed yet are removed from the round array
                    //We also get reward amount for each block from daemon reply
                    rounds = rounds.filter(function(r){
                        var tx = txDetails.filter(function(t){ return t.result.txid === r.txHash; })[0];
                        if (tx.result.details[0].category !== 'generate') return false;
                        r.amount = tx.result.amount;
                        r.magnitude = r.reward / r.amount;
                        return true;
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


                var shareLookups = rounds.map(function(r){
                    return ['hgetall', coin + '_shares:round' + r.height]
                });

                redisClient.multi(shareLookups).exec(function(error, allWorkerShares){
                    if (error){
                        callback('done - redis error with multi get rounds share')
                        return;
                    }

                    var workerRewards = {};


                    for (var i = 0; i < rounds.length; i++){
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
                        return p + c.amount;
                    }, 0);

                    console.log(workerRewards);
                    console.log('pool profit percent' + ((poolTotalRewards - workerTotalRewards) / poolTotalRewards));
                    */

                    callback(null, rounds, workerRewards);
                });
            },


            /* Does a batch call to redis to get worker existing balances from coin_balances*/
            function(rounds, workerRewards, callback){

                var workers = Object.keys(workerRewards);

                redisClient.hmget([coin + '_balances'].concat(workers), function(error, results){
                    if (error){
                        callback('done - redis error with multi get rounds share')
                        return;
                    }


                    var workerBalances = {};

                    for (var i = 0; i < workers.length; i++){
                        workerBalances[workers[i]] = parseInt(results[i]) || 0;
                    }


                    callback(null, rounds, workerRewards, workerBalances)
                });

            },


            /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
            function(rounds, workerRewards, workerBalances, callback){

                /* if payments dont succeed (likely because daemon isnt responding to rpc), then cancel here
                   so that all of this can be tried again when the daemon is working. otherwise we will consider
                   payment sent after we cleaned up the db.
                 */

                /* In here do daemon.getbalance, figure out how many payments should be sent, see if the
                   remaining balance after payments-to-be sent is greater than the min reserver, otherwise
                   put everything in worker balances to be paid next time.


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
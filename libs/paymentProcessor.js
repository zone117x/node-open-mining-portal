var redis = require('redis');

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


    var checkTx = function(tx, blockHeight){
        daemon.cmd('gettransaction', [tx], function(results){
            //console.dir(results[0].response.details[0].category);
            var status = results[0].response.details[0].category;
            var amount = results[0].response.details[0].amount;
            if (status !== 'generate') return;
            var f = 'shares_' + coin + ':round' + blockHeight;
            console.log(f);
            redisClient.hgetall('shares_' + coin + ':round' + blockHeight, function(error, results){
                if (error || !results) return;
                console.log('okay ' + JSON.stringify(results));

                //get balances_coin from redis for each address in this round
                //add up total balances
                //send necessary payments
                //put left over balances in redis
                //clean up (move block entry to processedBlocks_coin) so this logic isn't called again

            });
        });
    };


    setInterval(function(){

        redisClient.smembers('blocks_' + coin, function(error, results){
            if (error){
                logger.error('redis', 'Could get blocks from redis ' + JSON.stringify(error));
                return;
            }

            results.forEach(function(item){
                var split = item.split(':');
                var tx = split[0];
                var blockHeight = split[1];
                checkTx(tx, blockHeight);
            });

        });


    }, processingConfig.paymentInterval * 1000);

};
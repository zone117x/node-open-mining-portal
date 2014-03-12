var redis = require('redis');
var Stratum = require('stratum-pool');


/*
This module deals with handling shares when in internal payment processing mode. It connects to a redis
database and inserts shares with the database structure of:

key: coin_name + ':' + block_height
value: a hash with..
        key:

 */


module.exports = function(logger, poolConfig){

    var internalConfig = poolConfig.shareProcessing.internal;
    var redisConfig = internalConfig.redis;
    var coin = poolConfig.coin.name;




    var connection;

    function connect(){

        var reconnectTimeout;

        connection = redis.createClient(redisConfig.port, redisConfig.host);
        connection.on('ready', function(){
            clearTimeout(reconnectTimeout);
            logger.debug('redis', 'Successfully connected to redis database');
        });
        connection.on('error', function(err){
            logger.error('redis', 'Redis client had an error: ' + JSON.stringify(err))
        });
        connection.on('end', function(){
            logger.error('redis', 'Connection to redis database as been ended');
            logger.warning('redis', 'Trying reconnection in 3 seconds...');
            reconnectTimeout = setTimeout(function(){
                connect();
            }, 3000);
        });
    }
    connect();


    this.handleShare = function(isValidShare, isValidBlock, shareData){


        if (!isValidShare) return;

        connection.hincrby([coin + '_shares:roundCurrent', shareData.worker, shareData.difficulty], function(error, result){
            if (error)
                logger.error('redis', 'Could not store worker share')
        });

        if (isValidBlock){
            connection.rename(coin + '_shares:roundCurrent', coin + '_shares:round' + shareData.height, function(result){
                console.log('rename result: ' + result);
            });
            connection.sadd([coin + '_blocks', shareData.tx + ':' + shareData.height], function(error, result){
                if (error)
                    logger.error('redis', 'Could not store block data');
            });
        }

    };

};
var redis = require('redis');

module.exports = function(logger, poolConfig){

    var redisConfig = poolConfig.shareProcessing.internal.redis;
    var coin = poolConfig.coin.name;

    var connection;

    function connect(){

        var reconnectTimeout;

        var connection = redis.createClient(redisConfig.port, redisConfig.host);
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

        connection.hincrby([coin + ':' + shareData.height, shareData.worker, shareData.difficulty], function(error, result){
            if (error)
                logger.error('redis', 'Could not store worker share')
        });

    };

};
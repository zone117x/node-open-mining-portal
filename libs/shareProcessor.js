var redis = require('redis');

module.exports = function(logger, poolConfig){

    var redisConfig = poolConfig.shareProcessing.internal.redis;
    var coin = poolConfig.coin.name;

    var connection;

    function connect(){
        var connection = connections[coin] = redis.createClient(redisConfig.port, redisConfig.host);
        connection.on('error', function(err){
            logger.error('redis', 'Redis client had an error: ' + JSON.stringify(err))
        });
        connection.on('end', function(){
            logger.warning('redis', 'Connection to redis database as been ended');
            connect();
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
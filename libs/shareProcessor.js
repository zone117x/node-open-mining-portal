var redis = require('redis');

module.exports = function(logger, poolConfigs){


    var dbConnections = (function(){
        var connections = {};
        Object.keys(poolConfigs).forEach(function(coin) {

            var config = poolConfigs[coin];

            if (!config.shareProcessing || !config.shareProcessing.internal || !config.shareProcessing.internal.enabled)
                return;

            var redisConfig = config.shareProcessing.internal.redis;

            function connect(){
                var connection = connections[coin] = redis.createClient(redisConfig.port, redisConfig.host);
                connection.on('error', function(err){
                    logger.logError('shareProcessor', 'redis', coin +
                        ' - redis client had an error: ' + JSON.stringify(err))
                });
                connection.on('end', function(){
                    logger.logWarning('shareProcessor', 'redis', coin +
                        ' - connection to redis database as been ended');
                    connect();
                });
            }
            connect();
        });
    })();


    this.handleDifficultyUpdate = function(data){
        var coin = data.coin;
        var poolConfig = poolConfigs[coin];
    };

    this.handleShare = function(data){

        if ((!data.coin in dbConnections)) return;

        if (!data.isValidShare) return;

        var connection = dbConnections[data.coin];

        var shareData = data.share;
        var coin = data.coin;
        var poolConfig = poolConfigs[coin];

        connection.hincrby([coin + ':' + shareData.height, shareData.worker, shareData.difficulty], function(error, result){
            if (error)
                logger.logError('shareProcessor', 'redis', 'could not store worker share')
        });

    };

    this.handleBlock = function(data){
        //
    };
};
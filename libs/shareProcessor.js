var redis = require('redis');

module.exports = function(logger, poolConfigs){


    //TODO: need to add redis config to json. probably do one redis client per pool?

    var client;

    client = redis.createClient();

    client.on("error", function (err) {
        logger.logError('shareProcessor', 'redis', 'Redis client had an error: ' + err);
    });

    this.handleDifficultyUpdate = function(data){
        var coin = data.coin;
        var poolConfig = poolConfigs[coin];
        if (poolConfig.shareProcessing.mpos && poolConfig.shareProcessing.mpos.enabled){
            poolMposHandlers[coin].updateDifficulty(data.workerName, data.diff);
        }
    };

    this.handleShare = function(data){
        var shareData = data.share;
        var coin = data.coin;
        var poolConfig = poolConfigs[coin];

        if (poolConfig.shareProcessing.mpos && poolConfig.shareProcessing.mpos.enabled){
            poolMposHandlers[coin].insertShare(data.isValidShare, data.isValidBlock, shareData);
        }

        if (poolConfig.shareProcessing.internal && poolConfig.shareProcessing.internal.enable && data.isValidShare){
            client.hincrby([coin + ':' + shareData.height, shareData.worker, shareData.difficulty], function(error, result){
                if (error)
                    logger.logError('shareProcessor', 'redis', 'could not store worker share')
            });
        }
    };

    this.handleBlock = function(data){
        //
    };
};
var Stratum = require('stratum-pool');

module.exports = function(logger){


    var logDebug   = logger.logDebug;
    var logWarning = logger.logWarning;
    var logError   = logger.logError;


    var poolConfigs = JSON.parse(process.env.pools);
    var fork = process.env.fork;

    var pools = [];

    //Handle blocknotify message from master process sent via IPC
    process.on('message', function(message) {
        if (message.blocknotify){
            for (var i = 0; i < pools.length; i++){
                if (pools[i].options.coin.name.toLowerCase() === message.coin.toLowerCase()){
                    pools[i].processBlockNotify(message.blockHash)
                    return;
                }
            }
        }
    });


    Object.keys(poolConfigs).forEach(function(coin) {

        var poolOptions = poolConfigs[coin];

        var logIdentify = coin + ' (Fork ' + fork + ')';

        var authorizeFN = function (ip, workerName, password, callback) {
            // Default implementation just returns true
            logDebug(logIdentify, 'client', "Authorize [" + ip + "] " + workerName + ":" + password);
            callback({
                error: null,
                authorized: true,
                disconnect: false
            });
        };


        var pool = Stratum.createPool(poolOptions, authorizeFN);
        pool.on('share', function(isValidShare, isValidBlock, data){

            var shareData = JSON.stringify(data);

            if (data.solution && !isValidBlock){
                logDebug(logIdentify, 'client', 'We thought a block solution was found but it was rejected by the daemon, share data: ' + shareData);
            }
            else if (!isValidShare){
                logDebug(logIdentify, 'client', 'Invalid share submitted, share data: ' + shareData)
            }

            logDebug(logIdentify, 'client', 'Valid share submitted, share data: ' + shareData);
            process.send({
                type: 'share',
                share: shareData,
                coin: poolOptions.coin.name,
                isValidShare: isValidShare,
                isValidBlock: isValidBlock
            });

            if (isValidBlock){
                logDebug(logIdentify, 'client', 'Block found, solution: ' + shareData.solution);
                process.send({
                    type: 'block',
                    share: shareData,
                    coin: poolOptions.coin.name
                });
            }

        }).on('log', function(severity, logKey, logText) {
                if (severity == 'debug') {
                    logDebug(logIdentify, logKey, logText);
                } else if (severity == 'warning') {
                    logWarning(logIdentify, logKey, logText);
                } else if (severity == 'error') {
                    logError(logIdentify, logKey, logText);
                }
            });
        pool.start();
        pools.push(pool);
    });
};
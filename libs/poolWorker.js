var cluster = require('cluster');

var Stratum = require('stratum-pool');

module.exports = function(logger){


    var logDebug   = logger.logDebug;
    var logWarning = logger.logWarning;
    var logError   = logger.logError;


    var poolConfigs = JSON.parse(process.env.pools);
    var fork = process.env.fork;

    var pools = [];

    //Handle messages from master process sent via IPC
    process.on('message', function(message) {
        switch(message.type){
            case 'blocknotify':
                for (var i = 0; i < pools.length; i++){
                    if (pools[i].options.coin.name.toLowerCase() === message.coin.toLowerCase()){
                        pools[i].processBlockNotify(message.hash)
                        return;
                    }
                }
                break;
            case 'mposAuth':
                var callbackId = message.callbackId;
                if (callbackId in mposAuthCallbacks)
                    mposAuthCallbacks[callbackId](message.authorized);
                break;
        }
    });


    var mposAuthCallbacks = {};

    Object.keys(poolConfigs).forEach(function(coin) {

        var poolOptions = poolConfigs[coin];

        var logIdentify = coin + ' (Fork ' + fork + ')';

        var authorizeFN = function (ip, workerName, password, callback) {
            // Default implementation just returns true
            logDebug(logIdentify, 'client', "Authorize [" + ip + "] " + workerName + ":" + password);

            var mposAuthLevel;
            if (poolOptions.shareProcessing.mpos.enabled && (
                (mposAuthLevel = poolOptions.shareProcessing.mpos.stratumAuth) === 'worker' ||
                    mposAuthLevel === 'password'
            )){
                var callbackId = coin + workerName + password + Date.now();
                var authTimeout = setTimeout(function(){
                    if (!(callbackId in mposAuthCallbacks))
                        return;
                    callback({
                        error: null,
                        authorized: false,
                        disconnect: false
                    });
                    delete mposAuthCallbacks[callbackId];
                }, 30000);
                mposAuthCallbacks[callbackId] = function(authorized){
                    callback({
                        error: null,
                        authorized: authorized,
                        disconnect: false
                    });
                    delete mposAuthCallbacks[callbackId];
                    clearTimeout(authTimeout);
                };
                process.send({
                    type: 'mposAuth',
                    coin: poolOptions.coin.name,
                    callbackId: callbackId,
                    workerId: cluster.worker.id,
                    workerName: workerName,
                    password: password,
                    authLevel: mposAuthLevel
                });
            }
            else{
                callback({
                    error: null,
                    authorized: true,
                    disconnect: false
                });
            }
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

        }).on('difficultyUpdate', function(workerName, diff){
            if (poolOptions.shareProcessing.mpos.enabled){
                process.send({
                    type: 'difficultyUpdate',
                    workerName: workerName,
                    diff: diff,
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
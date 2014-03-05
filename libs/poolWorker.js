var cluster = require('cluster');

var Stratum = require('stratum-pool');

var MposCompatibility = require('./mposCompatibility.js');
var ShareProcessor = require('./shareProcessor.js');

module.exports = function(logger){


    var poolConfigs = JSON.parse(process.env.pools);
    var forkId = process.env.forkId;

    var pools = {};

    //Handle messages from master process sent via IPC
    process.on('message', function(message) {
        switch(message.type){
            case 'blocknotify':
                var pool = pools[message.coin.toLowerCase()]
                if (pool) pool.processBlockNotify(message.hash)
                break;
        }
    });


    Object.keys(poolConfigs).forEach(function(coin) {

        var poolOptions = poolConfigs[coin];

        var logIdentify = coin + ' (Fork ' + forkId + ')';

        var poolLogger = {
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

        var handlers = {
            auth: function(){},
            share: function(){},
            diff: function(){}
        };

        var shareProcessing = poolOptions.shareProcessing;

        //Functions required for MPOS compatibility
        if (shareProcessing.mpos && shareProcessing.mpos.enabled){
            var mposCompat = new MposCompatibility(poolLogger, poolOptions)

            handlers.auth = function(workerName, password, authCallback){
                mposCompat.handleAuth(workerName, password, authCallback);
            };

            handlers.share = function(isValidShare, isValidBlock, data){
                mposCompat.handleShare(isValidShare, isValidBlock, data);
            };

            handlers.diff = function(workerName, diff){
                mposCompat.handleDifficultyUpdate(workerName, diff);
            }
        }

        //Functions required for internal payment processing
        else if (shareProcessing.internal && shareProcessing.internal.enabled){

            var shareProcessor = new ShareProcessor(poolLogger, poolOptions)

            handlers.auth = function(workerName, password, authCallback){
                authCallback({
                    error: null,
                    authorized: true,
                    disconnect: false
                });
            };

            handlers.share = function(isValidShare, isValidBlock, data){
                shareProcessor.handleShare(isValidShare, isValidBlock, data);
            };
        }

        var authorizeFN = function (ip, workerName, password, callback) {
            handlers.auth(workerName, password, function(authorized){

                var authString = authorized ? 'Authorized' : 'Unauthorized ';

                poolLogger.debug('client', authorized + ' [' + ip + '] ' + workerName + ':' + password);
                callback({
                    error: null,
                    authorized: authorized,
                    disconnect: false
                });
            });
        };


        var pool = Stratum.createPool(poolOptions, authorizeFN);
        pool.on('share', function(isValidShare, isValidBlock, data){

            var shareData = JSON.stringify(data);

            if (data.solution && !isValidBlock)
                poolLogger.debug('client', 'We thought a block solution was found but it was rejected by the daemon, share data: ' + shareData);
            else if (isValidBlock)
                poolLogger.debug('client', 'Block found, solution: ' + shareData.solution);

            if (isValidShare)
                poolLogger.debug('client', 'Valid share submitted, share data: ' + shareData);
            else if (!isValidShare)
                poolLogger.debug('client', 'Invalid share submitted, share data: ' + shareData)


            handlers.share(isValidShare, isValidBlock, data)


        }).on('difficultyUpdate', function(workerName, diff){
            handlers.diff(workerName, diff);
        }).on('log', function(severity, logKey, logText) {
            if (severity == 'debug') {
                poolLogger.debug(logKey, logText);
            } else if (severity == 'warning') {
                poolLogger.warning(logKey, logText);
            } else if (severity == 'error') {
                poolLogger.error(logKey, logText);
            }
        });
        pool.start();
        pools[poolOptions.coin.name.toLowerCase()] = pool;
    });
};
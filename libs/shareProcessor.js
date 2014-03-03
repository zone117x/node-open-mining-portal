var events = require('events');
var cluster = require('cluster');

var redis = require('redis');
var mysql = require('mysql');

var processor = module.exports = function processor(logger, poolConfigs){

    var _this = this;

    var client;

    var poolMposHandlers = (function(){
        var handlers = {};

        Object.keys(poolConfigs).forEach(function(coin) {

            var config = poolConfigs[coin];

            if (!config.shareProcessing || !config.shareProcessing.mpos || !config.shareProcessing.mpos.enabled)
                return;
            var mposConfig = config.shareProcessing.mpos;
            var connection = mysql.createConnection({
                host: mposConfig.host,
                port: mposConfig.port,
                user: mposConfig.user,
                password: mposConfig.password,
                database: mposConfig.database
            });
            connection.connect(function(err){
                logger.logError('shareProcessor', 'database', config.coin.name +
                    ' - could not connect to mysql database: ' + JSON.stringify(err))
            });
            connection.on('error', function(err){
                logger.logError('shareProcessor', 'database', config.coin.name +
                    ' - mysql database error: ' + JSON.stringify(err))
            });

            var insertShare = function(isValidShare, isValidBlock, data){
                connection.query(
                    'INSERT INTO `shares` SET time = NOW(), rem_host = ?, username = ?, our_result = ?, upstream_result = ?, difficulty = ?, reason = ?, solution = ?',
                    [data.ip, data.worker, isValidShare ? 'Y' : 'N', isValidBlock ? 'Y' : 'N', data.difficulty, data.error, data.solution],
                    function(err, result) {
                        if (err)
                            logger.logError('shareProcessor', 'database', 'MySQL insert error when adding share: ' +
                                JSON.stringify(err));
                    }
                );
            };

            var updateDifficulty = function(workerName, diff){
                connection.query(
                    'UPDATE `pool_worker` SET `difficulty` = ' + diff + ' WHERE `username` = ' + connection.escape(workerName),
                    function(err, result){
                        if (err)
                            logger.logError('shareProcessor', 'database', 'MySQL error when updating worker diff: ' +
                                JSON.stringify(err));
                        else if (result.affectedRows === 0){
                            connection.query('INSERT INTO `pool_worker` SET ?', {username: workerName, difficulty: diff});
                        }
                        else
                            console.log('Updated difficulty successfully', result);
                    }
                );
            };

            handlers[config.coin.name] = {insertShare: insertShare, updateDifficulty: updateDifficulty};
        });
        return handlers;
    })();


    function handleShare(data){
        var shareData = data.share;
        var coin = data.coin;
        var poolConfig = poolConfigs[coin];

        if (poolConfig.shareProcessing.mpos && poolConfig.shareProcessing.mpos.enabled){
            poolMposHandlers[coin].insertShare(data.isValidShare, data.isValidBlock, shareData);
        }

        if (poolConfig.shareProcessing.internal && poolConfig.shareProcessing.internal.enable && data.isValidShare){
            client.hincrby([coin + ':' + shareData.height, shareData.worker, shareData.difficulty], function(error, result){
                if (error)
                    logger.logError('shareProcessor', 'database', 'could not store worker share')
            });
        }
    }

    function handleBlock(data){
        var requiredConfirmations = data.confirmations;
        //setInterval where we check for block confirmations
        //probably create our own rpc interface for each pool
    }

    this.init = function(){

        client = redis.createClient();

        client.on("error", function (err) {
            logger.logError('shareProcessor', 'database', 'Redis client had an error: ' + err);
        });

        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', function(data){
                switch(data.type){
                    case 'share':
                        handleShare(data);
                        break;
                    case 'block':
                        handleBlock(data)
                        break;
                }
            });
        });
    }
};


processor.prototype.__proto__ = events.EventEmitter.prototype;

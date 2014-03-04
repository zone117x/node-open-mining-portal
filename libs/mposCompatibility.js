var mysql = require('mysql');
var cluster = require('cluster');
module.exports = function(logger, poolConfigs){

    var dbConnections = (function(){
        var connections = {};


        Object.keys(poolConfigs).forEach(function(coin) {

            var config = poolConfigs[coin];

            if (!config.shareProcessing || !config.shareProcessing.mpos || !config.shareProcessing.mpos.enabled)
                return;

            var mposConfig = config.shareProcessing.mpos;

            function connect(){
                var connection = connections[coin] = mysql.createConnection({
                    host: mposConfig.host,
                    port: mposConfig.port,
                    user: mposConfig.user,
                    password: mposConfig.password,
                    database: mposConfig.database
                });
                connection.connect(function(err){
                    if (err)
                        logger.logError('shareProcessor', 'mysql', coin +
                            ' - could not connect to mysql database: ' + JSON.stringify(err))
                    else{
                        logger.logDebug('shareProcessor', 'mysql', coin +
                            ' - successful connection to MySQL database');
                    }
                });
                connection.on('error', function(err){
                    if(err.code === 'PROTOCOL_CONNECTION_LOST') {
                        logger.logWarning('shareProcessor', 'mysql', coin +
                            ' - lost connection to MySQL database, attempting reconnection...');
                        connect();
                    }
                    else{
                        logger.logError('shareProcessor', 'mysql', coin +
                            ' - mysql database error: ' + JSON.stringify(err))
                    }
                });
            }
            connect();
        });
        return connections;
    })();


    this.handleAuth = function(data){
        /*
         type: 'mposAuth',
         coin: poolOptions.coin.name,
         callbackId: callbackId,
         workerId: cluster.worker.id,
         workerName: workerName,
         password: password,
         authLevel: authLevel
         */

        var sendResult = function(authorized){
            cluster.workers[data.workerId].send({
                type       : 'mposAuth',
                callbackId : data.callbackId,
                authorized : authorized
            });
        };

        var connection = dbConnections[data.coin];
        connection.query(
            'SELECT password FROM pool_worker WHERE username = LOWER(?)',
            [data.workerName],
            function(err, result){
                if (err){
                    logger.logError('shareProcessor', 'mysql', 'MySQL error when authenticating worker: ' +
                        JSON.stringify(err));
                    sendResult(false);
                }
                else if (!result[0])
                    sendResult(false);
                else if (data.authLevel === 'worker')
                    sendResult(true);
                else if (result[0].password === data.password)
                    sendResult(true)
                else
                    sendResult(false);
            }
        );

    };

    this.handleShare = function(data){
        var isValidShare = data.isValidShare;
        var isValidBlock = data.isValidBlock;
        if ((!data.coin in dbConnections)) return;

        var connection = dbConnections[data.coin];
        var dbData = [
            data.share.ip, 
            data.share.worker, 
            isValidShare ? 'Y' : 'N', 
            isValidBlock ? 'Y' : 'N', 
            data.share.difficulty, 
            typeof(data.share.error)==='undefined'?null:data.share.error, 
            typeof(data.solution)==='undefined'?'':data.solution // solution?
        ];
        connection.query(
            'INSERT INTO `shares` SET time = NOW(), rem_host = ?, username = ?, our_result = ?, upstream_result = ?, difficulty = ?, reason = ?, solution = ?',
            dbData,
            function(err, result) {
                if (err)
                    logger.logError('shareProcessor', 'mysql', 'MySQL insert error when adding share: ' +
                        JSON.stringify(err));
            }
        );
    };

    this.handleDifficultyUpdate = function(workerName, diff){

        if ((!data.coin in dbConnections)) return;

        var connection = dbConnections[data.coin];
        connection.query(
            'UPDATE `pool_worker` SET `difficulty` = ' + diff + ' WHERE `username` = ' + connection.escape(workerName),
            function(err, result){
                if (err)
                    logger.logError('shareProcessor', 'mysql', 'MySQL error when updating worker diff: ' +
                        JSON.stringify(err));
                else if (result.affectedRows === 0){
                    connection.query('INSERT INTO `pool_worker` SET ?', {username: workerName, difficulty: diff});
                }
                else
                    console.log('Updated difficulty successfully', result);
            }
        );
    };


};
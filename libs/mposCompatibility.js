var mysql = require('mysql');
var cluster = require('cluster');
var request = require('request');
var bcrypt = require('bcrypt');
module.exports = function(logger, poolConfig) {

    var mposConfig = poolConfig.mposMode;
    var coin = poolConfig.coin.name;

    var connection = mysql.createPool({
        host: mposConfig.host,
        port: mposConfig.port,
        user: mposConfig.user,
        password: mposConfig.password,
        database: mposConfig.database
    });


    var logIdentify = 'MySQL';
    var logComponent = coin;



    this.handleAuth = function(workerName, password, authCallback) {

        if (poolConfig.validateWorkerUsername !== true && mposConfig.autoCreateWorker !== true) {
            authCallback(true);
            return;
        }

        connection.query(
            'SELECT password FROM pool_worker WHERE username = LOWER(?)', [workerName.toLowerCase()],
            function(err, result) {
                if (err) {
                    logger.error(logIdentify, logComponent, 'Database error when authenticating worker: ' +
                        JSON.stringify(err));
                    authCallback(false);
                } else if (!result[0]) {
                    if (mposConfig.autoCreateWorker) {
                        var account = workerName.split('.')[0];
                        connection.query(
                            'SELECT id,username FROM accounts WHERE username = LOWER(?)', [account.toLowerCase()],
                            function(err, result) {
                                if (err) {
                                    logger.error(logIdentify, logComponent, 'Database error when authenticating account: ' +
                                        JSON.stringify(err));
                                    authCallback(false);
                                } else if (!result[0]) {
                                    if (mposConfig.autoCreateAnonymousAccount) {
                                        logger.debug(logIdentify, logComponent, 'Creating new anonymous account.');
                                        validateCoinAddress(account, authCallback, connection, mposConfig);
                                    }
                                } else {
                                    connection.query(
                                        "INSERT INTO `pool_worker` (`account_id`, `username`, `password`) VALUES (?, ?, ?);", [result[0].id, workerName.toLowerCase(), password],
                                        function(err, result) {
                                            if (err) {
                                                logger.error(logIdentify, logComponent, 'Database error when insert worker: ' +
                                                    JSON.stringify(err));
                                                authCallback(false);
                                            } else {
                                                authCallback(true);
                                            }
                                        })
                                }
                            }
                        );
                    } else {
                        authCallback(false);
                    }
                } else if (mposConfig.checkPassword && result[0].password !== password)
                    authCallback(false);
                else
                    authCallback(true);
            }
        );

    };

    this.handleShare = function(isValidShare, isValidBlock, shareData) {

        var dbData = [
            shareData.ip,
            shareData.worker,
            isValidShare ? 'Y' : 'N',
            isValidBlock ? 'Y' : 'N',
            shareData.difficulty * (poolConfig.coin.mposDiffMultiplier || 1),
            typeof(shareData.error) === 'undefined' ? null : shareData.error,
            shareData.blockHash ? shareData.blockHash : (shareData.blockHashInvalid ? shareData.blockHashInvalid : '')
        ];
        connection.query(
            'INSERT INTO `shares` SET time = NOW(), rem_host = ?, username = ?, our_result = ?, upstream_result = ?, difficulty = ?, reason = ?, solution = ?',
            dbData,
            function(err, result) {
                if (err)
                    logger.error(logIdentify, logComponent, 'Insert error when adding share: ' + JSON.stringify(err));
                else
                    logger.debug(logIdentify, logComponent, 'Share inserted');
            }
        );
    };

    this.handleDifficultyUpdate = function(workerName, diff) {

        connection.query(
            'UPDATE `pool_worker` SET `difficulty` = ' + diff + ' WHERE `username` = ' + connection.escape(workerName),
            function(err, result) {
                if (err)
                    logger.error(logIdentify, logComponent, 'Error when updating worker diff: ' +
                        JSON.stringify(err));
                else if (result.affectedRows === 0) {
                    connection.query('INSERT INTO `pool_worker` SET ?', {
                        username: workerName,
                        difficulty: diff
                    });
                } else
                    console.log('Updated difficulty successfully', result);
            }
        );
    };
};

// Generate random encrypted password for anonymous user
function makePW(mposConfig) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 8; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    var hash = bcrypt.hashSync(text, mposConfig.salt);
    hash = '$1$' + mposConfig.salt + '$' + hash;
    return hash;
}

function randomPIN(mposConfig) {
    var text = "";
    var possible = "0123456789";

    for (var i = 0; i < 4; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    var hash = bcrypt.hashSync(text, mposConfig.salt);
    return hash;
}

// Validate the coin address used for anonymous user
function validateCoinAddress(address, authCallback, connection, mposConfig) {
    var result = false;

    if (address.length > 34 || address.length < 27)
        return result;

    if (/[0OIl]/.test(address))
        return result;

    request('https://blockchain.info/it/q/addressbalance/' + address, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var isnum = /^\d+$/.test(body);
            if (isnum) {
                createNewAnonymousAccount(address, authCallback, connection, mposConfig);
            }
        }
    })
}

function createNewAnonymousAccount(account, authCallback, connection, mposConfig) {
    connection.query("INSERT INTO 'accounts' ('is_anonymous', 'username', 'pass', 'signup_timestamp', 'pin', 'donate_percent') VALUES (?, ?, ?, ?, ?, ?);", [1, account.toLowerCase(), makePW(mposConfig), Math.floor(Date.now() / 1000), randomPIN(mposConfig), 1],
        function(err, result) {
            if (err) {
                logger.error(logIdentify, logComponent, 'Could not create new user: ' + JSON.stringify(err));
                authCallback(false);
            } else {
                logger.debug(logIdentify, logComponent, 'results of new account: ' + JSON.stringify(result[0]));
                connection.query("INSERT INTO 'coin_addresses' ('account_id', 'currency', 'coin_address', 'ap_threshold') VALUES (?, ?, ?, ?);", [result[0].id, symbol, account, 0.1],
                    function(err, result) {
                        if (err) {
                            logger.error(logIdentify, logComponent, 'Could not create coin address for anon user: ' + JSON.stringify(err));
                            authCallback(false);
                        } else {
                            connection.query("INSERT INTO 'pool_worker' ('account_id', 'username', 'password') VALUES (?, ?, ?);", [result[0].account_id, workerName.toLowerCase(), password],
                                function(err, result) {
                                    if (err) {
                                        logger.error(logIdentify, logComponent, 'Database error when insert worker: ' +
                                            JSON.stringify(err));
                                        authCallback(false);
                                    } else {
                                        logger.debug(logIdentify, logComponent, 'New anonymous user account created with coin address: ' + account);
                                        authCallback(true);
                                    }
                                });
                        }
                    });
            }
        });
}
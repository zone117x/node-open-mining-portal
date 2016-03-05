var mysql = require('mysql');
var cluster = require('cluster');
var request = require('request');
var bcrypt = require('bcrypt');
var exec = require('child_process').exec;
var cmd = 'sudo service mysql restart';
module.exports = function(logger, poolConfig) {

    var mposConfig = poolConfig.mposMode;
    var coin = poolConfig.coin.name;
    var symbol = poolConfig.coin.symbol;

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
                                        validateCoinAddress(account, workerName, password, authCallback, connection, logger, logIdentify, logComponent, symbol);
                                    } else {
                                        authCallback(false);
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
                if (err) {
                    logger.error(logIdentify, logComponent, 'Insert error when adding share: ' + JSON.stringify(err));
                    exec(cmd, function(error, stdout, stderr) {
                        logger.debug(logSystem, logComponent, logSubCat, 'Mysql server restarted: ' + stdout);
                    });
                } else
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

// Generate random encrypted password for anonymous user (will never be used, user cannot login)
function makePW() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 8; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    salt = bcrypt.genSaltSync(12);
    var hash = bcrypt.hashSync(text, salt);
    return hash;
}

// get a random pin (will never be used, user cannot login)
function randomPIN() {
    var text = "";
    var possible = "0123456789";

    for (var i = 0; i < 4; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    salt = bcrypt.genSaltSync(12);
    var hash = bcrypt.hashSync(text, salt);
    return hash;
}

// Validate the coin address used for anonymous user
function validateCoinAddress(address, workerName, password, authCallback, connection, logger, logIdentify, logComponent, symbol) {
    // only works for bitcoin
    if (symbol === 'BTC') {
        var result = false;

        if (address.length > 34 || address.length < 27)
            return result;

        if (/[0OIl]/.test(address))
            return result;

        request('https://blockchain.info/it/q/addressbalance/' + address, function(error, response, body) {
            if (!error && response.statusCode == 200) {
                var isnum = /^\d+$/.test(body);
                if (isnum) {
                    // Make call to new method because of asynchronous request
                    createNewAnonymousAccount(address, workerName, password, authCallback, connection, logger, logIdentify, logComponent, symbol);
                }
            }
        })
    } else {
        // TODO: add  extravalidation towards other coins
        createNewAnonymousAccount(address, workerName, password, authCallback, connection, logger, logIdentify, logComponent, symbol);
    }
}

// Create the new anonymous user
function createNewAnonymousAccount(account, workerName, password, authCallback, connection, logger, logIdentify, logComponent, symbol) {
    // There comes a price on being anonymous: TODO, bring this to config
    var donationAmount = 1;
    connection.query("INSERT INTO accounts (is_anonymous, username, pass, signup_timestamp, pin, donate_percent) VALUES (?, ?, ?, ?, ?, ?);", [1, account.toLowerCase(), makePW(), Math.floor(Date.now() / 1000), randomPIN(), donationAmount],
        function(err, result) {
            if (err) {
                logger.error(logIdentify, logComponent, 'Could not create new user: ' + JSON.stringify(err));
                authCallback(false);
            } else {
                // Get the new user's id
                connection.query(
                    'SELECT id FROM accounts WHERE username = LOWER(?)', [account.toLowerCase()],
                    function(err, result) {
                        if (err) {
                            logger.error(logIdentify, logComponent, 'Could not get new user: ' + JSON.stringify(err));
                            authCallback(false);
                        } else if (!result[0]) {
                            authCallback(false);
                        } else {
                            var accountId = result[0].id;
                            logger.debug(logIdentify, logComponent, 'results of new account: ' + JSON.stringify(result[0]));
                            // Insert user's coin address for payouts
                            connection.query("INSERT INTO coin_addresses (account_id, currency, coin_address, ap_threshold) VALUES (?, ?, ?, ?);", [accountId, symbol, account, 0.1],
                                function(err, result) {
                                    if (err) {
                                        logger.error(logIdentify, logComponent, 'Could not create coin address for anon user: ' + JSON.stringify(err));
                                        authCallback(false);
                                    } else {
                                        // Finally, make the worker
                                        connection.query("INSERT INTO pool_worker (account_id, username, password) VALUES (?, ?, ?);", [accountId, workerName.toLowerCase(), password],
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
        });
}
var async = require('async');

var Poloniex = require('./apiPoloniex.js');
var Stratum = require('stratum-pool');

module.exports = function(logger){

    var _this = this;

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var logSystem = 'Profit';

    // 
    // build status tracker for collecting coin market information
    //
    var profitStatus = {};
    var profitSymbols = {};
    Object.keys(poolConfigs).forEach(function(coin){

        var poolConfig = poolConfigs[coin];
        var algo       = poolConfig.coin.algorithm;

        if (!profitStatus.hasOwnProperty(algo)) {
            profitStatus[algo] = {};
        }
        var coinStatus = {
            name: poolConfig.coin.name,
            symbol: poolConfig.coin.symbol,
            difficulty: 0,
            reward: 0,
            prices: {},
            depths: {},
            volumes: {},
        };
        profitStatus[algo][poolConfig.coin.symbol] = coinStatus;
        profitSymbols[poolConfig.coin.symbol] = algo;
    });


    // 
    // ensure we have something to switch
    //
    var isMoreThanOneCoin = false;
    Object.keys(profitStatus).forEach(function(algo){
        if (Object.keys(profitStatus[algo]).length > 1) {
            isMoreThanOneCoin = true;
        }
    });
    if (!isMoreThanOneCoin){
        logger.debug(logSystem, 'Config', 'No alternative coins to switch to in current config, switching disabled.');
        return;
    }
    logger.debug(logSystem, 'profitStatus', JSON.stringify(profitStatus));
    logger.debug(logSystem, 'profitStatus', JSON.stringify(profitSymbols));


    // 
    // setup APIs
    //
    var poloApi =  new Poloniex(
        // 'API_KEY',
        // 'API_SECRET'
    );

    // 
    // market data collection from Poloniex
    //
    this.getProfitDataPoloniex = function(callback){
        async.series([
            function(taskCallback){
                poloApi.getTicker(function(err, data){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    Object.keys(profitSymbols).forEach(function(symbol){
                        var btcPrice = new Number(0);
                        var ltcPrice = new Number(0);

                        if (data.hasOwnProperty('BTC_' + symbol)) {
                            btcPrice = new Number(data['BTC_' + symbol]);
                        }
                        if (data.hasOwnProperty('LTC_' + symbol)) {
                            ltcPrice = new Number(data['LTC_' + symbol]);
                        }

                        if (btcPrice > 0 || ltcPrice > 0) {
                            var prices = {
                                BTC: btcPrice,
                                LTC: ltcPrice
                            };
                            profitStatus[profitSymbols[symbol]][symbol].prices['Poloniex'] = prices;
                        }
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                poloApi.get24hVolume(function(err, data){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    Object.keys(profitSymbols).forEach(function(symbol){
                        var btcVolume = new Number(0);
                        var ltcVolume = new Number(0);

                        if (data.hasOwnProperty('BTC_' + symbol)) {
                            btcVolume = new Number(data['BTC_' + symbol].BTC);
                        }
                        if (data.hasOwnProperty('LTC_' + symbol)) {
                            ltcVolume = new Number(data['LTC_' + symbol].LTC);
                        }

                        if (btcVolume > 0 || ltcVolume > 0) {
                            var volumes = {
                                BTC: btcVolume,
                                LTC: ltcVolume
                            };
                            profitStatus[profitSymbols[symbol]][symbol].volumes['Poloniex'] = volumes;
                        }
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(profitSymbols).forEach(function(symbol){
                    var coinVolumes = profitStatus[profitSymbols[symbol]][symbol].volumes;
                    var coinPrices  = profitStatus[profitSymbols[symbol]][symbol].prices;

                    if (coinVolumes.hasOwnProperty('Poloniex') && coinPrices.hasOwnProperty('Poloniex')){
                        var btcDepth = new Number(0);
                        var ltcDepth = new Number(0);

                        if (coinVolumes['Poloniex']['BTC'] > 0 && coinPrices['Poloniex']['BTC'] > 0){
                            var coinPrice = new Number(coinPrices['Poloniex']['BTC']);
                            depthTasks.push(function(callback){
                                _this.getMarketDepthFromPoloniex('BTC', symbol, coinPrice, callback)
                            });
                        }
                        if (coinVolumes['Poloniex']['LTC'] > 0 && coinPrices['Poloniex']['LTC'] > 0){
                            var coinPrice = new Number(coinPrices['Poloniex']['LTC']);
                            depthTasks.push(function(callback){
                                _this.getMarketDepthFromPoloniex('LTC', symbol, coinPrice, callback)
                            });
                        }
                    }
                });

                if (depthTasks.length == 0){
                    taskCallback;
                    return;
                }
                async.parallel(depthTasks, function(err){
                    if (err){
                        taskCallback(err);
                        return;
                    }
                    taskCallback();
                });
            }
        ], function(err){
            if (err){
                callback(err);
                return;
            }
            callback(null);
        });
        
    };
    this.getMarketDepthFromPoloniex = function(symbolA, symbolB, coinPrice, callback){
        poloApi.getOrderBook(symbolA, symbolB, function(err, data){
            if (err){
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (data.hasOwnProperty('bids')){
                data['bids'].forEach(function(order){
                    var price = new Number(order[0]);
                    var qty = new Number(order[1]);
                    // only measure the depth down to configured depth
                    if (price >= coinPrice * portalConfig.profitSwitch.depth){
                       depth += (qty * price);
                    }
                });
            }

            if (!profitStatus[profitSymbols[symbolB]][symbolB].depths.hasOwnProperty('Poloniex')){
                profitStatus[profitSymbols[symbolB]][symbolB].depths['Poloniex'] = {
                    BTC: 0,
                    LTC: 0
                };
            }
            profitStatus[profitSymbols[symbolB]][symbolB].depths['Poloniex'][symbolA] = depth;
            callback();
        });
    };

    // TODO
    this.getProfitDataCryptsy = function(callback){
        callback(null);
    };

    this.getCoindDaemonInfo = function(callback){
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function(algo){
            Object.keys(profitStatus[algo]).forEach(function(symbol){
                var coinName = profitStatus[algo][symbol].name;
                var poolConfig = poolConfigs[coinName];
                var daemonConfig =  poolConfig.shareProcessing.internal.daemon;
                daemonTasks.push(function(callback){
                    _this.getDaemonInfoForCoin(symbol, daemonConfig, callback)
                });
            });
        });

        if (daemonTasks.length == 0){
            callback();
            return;
        }
        async.parallel(daemonTasks, function(err){
            if (err){
                callback(err);
                return;
             }
             callback(null);
        });
    };
    this.getDaemonInfoForCoin = function(symbol, cfg, callback){
        var daemon = new Stratum.daemon.interface([cfg]);
        daemon.once('online', function(){
            daemon.cmd('getdifficulty', null, function(result){
                if (result[0].error != null){
                    callback(result[0].error);
                    return;
                }
                profitStatus[profitSymbols[symbol]][symbol].difficulty = result[0].response;

                daemon.cmd('getblocktemplate', 
                    [{"capabilities": [ "coinbasetxn", "workid", "coinbase/append" ]}],
																				function(result){
                        if (result[0].error != null){
                            callback(result[0].error);
                            return;
                        }
                        profitStatus[profitSymbols[symbol]][symbol].reward = new Number(result[0].response.coinbasevalue / 100000000);
																});
                callback(null)
            });
        }).once('connectionFailed', function(error){
            callback(error);
        }).on('error', function(error){
            callback(error);
        }).init();
    };


    var checkProfitability = function(){
        logger.debug(logSystem, 'Check', 'Running mining profitability check.');

        async.parallel([
            _this.getProfitDataPoloniex,
            _this.getProfitDataCryptsy,
            _this.getCoindDaemonInfo
        ], function(err){
            if (err){
                logger.error(logSystem, 'Check', 'Error while checking profitability: ' + err);
                return;
            }
            logger.debug(logSystem, 'Check', JSON.stringify(profitStatus));
        });
    };
    setInterval(checkProfitability, portalConfig.profitSwitch.updateInterval * 1000);

};

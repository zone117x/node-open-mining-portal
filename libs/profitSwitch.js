var async = require('async');

var Cryptsy = require('./apiCryptsy.js');
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
    var symbolToAlgorithmMap = {};
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
            exchangeInfo: {}
        };
        profitStatus[algo][poolConfig.coin.symbol] = coinStatus;
        symbolToAlgorithmMap[poolConfig.coin.symbol] = algo;
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


    // 
    // setup APIs
    //
    var poloApi =  new Poloniex(
        // 'API_KEY',
        // 'API_SECRET'
    );
    var cryptsyApi =  new Cryptsy(
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

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
																								if (!exchangeInfo.hasOwnProperty('Poloniex'))
																								    exchangeInfo['Poloniex'] = {};
																								var marketData = exchangeInfo['Poloniex'];

                        if (data.hasOwnProperty('BTC_' + symbol)) {
																									   if (!marketData.hasOwnProperty('BTC'))
																												    marketData['BTC'] = {};

																									   var btcData = data['BTC_' + symbol];
                            marketData['BTC'].ask = new Number(btcData.lowestAsk);
                            marketData['BTC'].bid = new Number(btcData.highestBid);
                            marketData['BTC'].last = new Number(btcData.last);
                            marketData['BTC'].baseVolume = new Number(btcData.baseVolume);
                            marketData['BTC'].quoteVolume = new Number(btcData.quoteVolume);
                        }
                        if (data.hasOwnProperty('LTC_' + symbol)) {
																									   if (!marketData.hasOwnProperty('LTC'))
																												    marketData['LTC'] = {};

																									   var ltcData = data['LTC_' + symbol];
                            marketData['LTC'].ask = new Number(ltcData.lowestAsk);
                            marketData['LTC'].bid = new Number(ltcData.highestBid);
                            marketData['LTC'].last = new Number(ltcData.last);
                            marketData['LTC'].baseVolume = new Number(ltcData.baseVolume);
                            marketData['LTC'].quoteVolume = new Number(ltcData.quoteVolume);
                        }
                    });
                    taskCallback();
                });
            },
            function(taskCallback){
                var depthTasks = [];
                Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                    var marketData = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo['Poloniex'];
                    if (marketData.hasOwnProperty('BTC') && marketData['BTC'].bid > 0){
                        depthTasks.push(function(callback){
																								    _this.getMarketDepthFromPoloniex('BTC', symbol, marketData['BTC'].bid, callback) 
																								});
                    }
                    if (marketData.hasOwnProperty('LTC') && marketData['LTC'].bid > 0){
                        depthTasks.push(function(callback){
																								    _this.getMarketDepthFromPoloniex('LTC', symbol, marketData['LTC'].bid, callback) 
																								});
                    }
                });

                if (!depthTasks.length){
                    taskCallback();
                    return;
                }
                async.series(depthTasks, function(err){
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
																				var limit = new Number(coinPrice * portalConfig.profitSwitch.depth);
                    var qty = new Number(order[1]);
                    // only measure the depth down to configured depth
                    if (price >= limit){
                       depth += (qty * price);
                    }
                });
            }

            var marketData = profitStatus[symbolToAlgorithmMap[symbolB]][symbolB].exchangeInfo['Poloniex'];
            marketData[symbolA].depth = depth;
            callback();
        });
    };

    
    this.getProfitDataCryptsy = function(callback){
        async.series([
            function(taskCallback){
                cryptsyApi.getTicker(function(err, data){
                    if (err || data.success != 1){
                        taskCallback(err);
                        return;
                    }

                    Object.keys(symbolToAlgorithmMap).forEach(function(symbol){
                        var exchangeInfo = profitStatus[symbolToAlgorithmMap[symbol]][symbol].exchangeInfo;
																								if (!exchangeInfo.hasOwnProperty('Cryptsy'))
																								    exchangeInfo['Cryptsy'] = {};

																								var marketData = exchangeInfo['Cryptsy'];
																								var results    = data.return.markets;

                        if (results.hasOwnProperty(symbol + '/BTC')) {
																								    if (!marketData.hasOwnProperty('BTC'))
																												    marketData['BTC'] = {};

																									   var btcData = results[symbol + '/BTC'];
                            marketData['BTC'].last = new Number(btcData.lasttradeprice);
                            marketData['BTC'].baseVolume = new Number(marketData['BTC'].last / btcData.volume);
                            marketData['BTC'].quoteVolume = new Number(btcData.volume);
																												if (btcData.sellorders != null)
                                marketData['BTC'].ask = new Number(btcData.sellorders[0].price);
																												if (btcData.buyorders != null) {
                                marketData['BTC'].bid = new Number(btcData.buyorders[0].price);
																																var limit = new Number(marketData['BTC'].bid * portalConfig.profitSwitch.depth);
                                var depth = new Number(0);
                                btcData['buyorders'].forEach(function(order){
                                    var price = new Number(order.price);
                                    var qty = new Number(order.quantity);
                                    if (price >= limit){
                                        depth += (qty * price);
                                    }
																															});
                               marketData['BTC'].depth = depth;
																											}
																				    }

                        if (data.hasOwnProperty(symbol + '/LTC')) {
																									   if (!marketData.hasOwnProperty('LTC'))
																												    marketData['LTC'] = {};

																									   var ltcData = results[symbol + '/LTC'];
                            marketData['LTC'].last = new Number(ltcData.lasttradeprice);
                            marketData['LTC'].baseVolume = new Number(marketData['LTC'].last / ltcData.volume);
                            marketData['LTC'].quoteVolume = new Number(ltcData.volume);
																												if (ltcData.sellorders != null)
                                marketData['LTC'].ask = new Number(ltcData.sellorders[0].price);
																												if (ltcData.buyorders != null) {
                                marketData['LTC'].bid = new Number(ltcData.buyorders[0].price);
																																var limit = new Number(marketData['LTC'].bid * portalConfig.profitSwitch.depth);
                                var depth = new Number(0);
                                ltcData['buyorders'].forEach(function(order){
                                    var price = new Number(order.price);
                                    var qty = new Number(order.quantity);
                                    if (price >= limit){
                                        depth += (qty * price);
                                    }
																															});
                               marketData['LTC'].depth = depth;
																											}
                        }
                    });
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


    this.getCoindDaemonInfo = function(callback){
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function(algo){
            Object.keys(profitStatus[algo]).forEach(function(symbol){
                var coinName = profitStatus[algo][symbol].name;
                var poolConfig = poolConfigs[coinName];
                var daemonConfig = poolConfig.shareProcessing.internal.daemon;
                daemonTasks.push(function(callback){
                    _this.getDaemonInfoForCoin(symbol, daemonConfig, callback)
                });
            });
        });

        if (daemonTasks.length == 0){
            callback();
            return;
        }
        async.series(daemonTasks, function(err){
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
												async.parallel([
																function(taskCallback){
																				daemon.cmd('getdifficulty', null, function(result){
																				    if (result[0].error != null){
																								    taskCallback(result[0].error);
																								    return;
																				    }
																				    profitStatus[symbolToAlgorithmMap[symbol]][symbol].difficulty = result[0].response;
																				    taskCallback(null);
																				});
																},
																function(taskCallback){
																				daemon.cmd('getblocktemplate', [{"capabilities": [ "coinbasetxn", "workid", "coinbase/append" ]}], function(result){
																								if (result[0].error != null){
																												taskCallback(result[0].error);
																												return;
																								}
																								profitStatus[symbolToAlgorithmMap[symbol]][symbol].reward = new Number(result[0].response.coinbasevalue / 100000000);
																								taskCallback(null);
																				});
																}
												], function(err){
																if (err){
																				callback(err);
																				return;
																}
																callback(null);
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

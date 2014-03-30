var redis = require('redis');
var async = require('async');

var os = require('os');

var algos = require('stratum-pool/lib/algoProperties.js');


module.exports = function(logger, portalConfig, poolConfigs){

    var _this = this;

    var logSystem = 'Stats';

    var redisClients = [];

    /*var algoMultipliers = {
        'x11': Math.pow(2, 16),
        'scrypt': Math.pow(2, 16),
        'scrypt-jane': Math.pow(2,16),
        'sha256': Math.pow(2, 32)
    };*/

    var canDoStats = true;

    Object.keys(poolConfigs).forEach(function(coin){

        if (!canDoStats) return;

        var poolConfig = poolConfigs[coin];

        if (!poolConfig.shareProcessing || !poolConfig.shareProcessing.internal){
            logger.error(logSystem, coin, 'Cannot do stats without internal share processing setup');
            canDoStats = false;
            return;
        }

        var internalConfig = poolConfig.shareProcessing.internal;
        var redisConfig = internalConfig.redis;

        for (var i = 0; i < redisClients.length; i++){
            var client = redisClients[i];
            if (client.client.port === redisConfig.port && client.client.host === redisConfig.host){
                client.coins.push(coin);
                return;
            }
        }
        redisClients.push({
            coins: [coin],
            client: redis.createClient(redisConfig.port, redisConfig.host)
        });
    });


    this.stats = {};
    this.statsString = '';


    this.getGlobalStats = function(callback){

        var allCoinStats = {};

        async.each(redisClients, function(client, callback){
            var windowTime = (((Date.now() / 1000) - portalConfig.website.hashrateWindow) | 0).toString();
            var redisCommands = [];


            var redisComamndTemplates = [
                ['zremrangebyscore', '_hashrate', '-inf', '(' + windowTime],
                ['zrangebyscore', '_hashrate', windowTime, '+inf'],
                ['hgetall', '_stats'],
                ['scard', '_blocksPending'],
                ['scard', '_blocksConfirmed'],
                ['scard', '_blocksOrphaned']
            ];

            var commandsPerCoin = redisComamndTemplates.length;

            client.coins.map(function(coin){
                redisComamndTemplates.map(function(t){
                    var clonedTemplates = t.slice(0);
                    clonedTemplates[1] = coin + clonedTemplates [1];
                    redisCommands.push(clonedTemplates);
                });
            });

            client.client.multi(redisCommands).exec(function(err, replies){
                if (err){
                    console.log('error with getting hashrate stats ' + JSON.stringify(err));
                    callback(err);
                }
                else{
                    for(var i = 0; i < replies.length; i += commandsPerCoin){
                        var coinName = client.coins[i / commandsPerCoin | 0];
                        var coinStats = {
                            name: coinName,
                            symbol: poolConfigs[coinName].coin.symbol.toUpperCase(),
                            algorithm: poolConfigs[coinName].coin.algorithm,
                            hashrates: replies[i + 1],
                            poolStats: replies[i + 2],
                            blocks: {
                                pending: replies[i + 3],
                                confirmed: replies[i + 4],
                                orphaned: replies[i + 5]
                            }
                        };
                        allCoinStats[coinStats.name] = (coinStats);
                    }
                    callback();
                }
            });
        }, function(err){
            if (err){
                console.log('error getting all stats' + JSON.stringify(err));
                callback();
                return;
            }

            var portalStats = {
                global:{
                    workers: 0,
                    hashrate: 0
                },
                pools: allCoinStats
            };

            Object.keys(allCoinStats).forEach(function(coin){
                var coinStats = allCoinStats[coin];
                coinStats.workers = {};
                coinStats.shares = 0;
                coinStats.hashrates.forEach(function(ins){
                    var parts = ins.split(':');
                    var workerShares = parseFloat(parts[0]);
                    coinStats.shares += workerShares;
                    var worker = parts[1];
                    if (worker in coinStats.workers)
                        coinStats.workers[worker] += workerShares
                    else
                        coinStats.workers[worker] = workerShares
                });
                var shareMultiplier = algos[coinStats.algorithm].multiplier || 0;
                var hashratePre = shareMultiplier * coinStats.shares / portalConfig.website.hashrateWindow;
                console.log([hashratePre, shareMultiplier, coinStats.shares, portalConfig.website.hashrateWindow]);
                coinStats.hashrate = hashratePre / 1e3 | 0;
                portalStats.global.hashrate += coinStats.hashrate;
                portalStats.global.workers += Object.keys(coinStats.workers).length;
                coinStats.hashrates;
                coinStats.shares;
            });

            _this.stats = portalStats;
            _this.statsString = JSON.stringify(portalStats);
            callback();
        });

    };
};


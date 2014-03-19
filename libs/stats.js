var redis = require('redis');
var async = require('async');

var os = require('os');


module.exports = function(logger, portalConfig, poolConfigs){

    var _this = this;

    var redisClients = [];

    Object.keys(poolConfigs).forEach(function(coin){
        var poolConfig = poolConfigs[coin];
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


    this.getStats = function(callback){

        var allCoinStats = [];

        async.each(redisClients, function(client, callback){
            var windowTime = (Date.now() / 1000 | 0) - portalConfig.website.hashrateWindow;
            var redisCommands = [];
            var commandsPerCoin = 4;

            //Clear out old hashrate stats for each coin from redis
            client.coins.forEach(function(coin){
                redisCommands.push(['zremrangebyscore', coin + '_hashrate', '-inf', windowTime]);
                redisCommands.push(['zrangebyscore', coin + '_hashrate', windowTime, '+inf']);
                redisCommands.push(['hgetall', coin + '_stats']);
                redisCommands.push(['scard', coin + '_blocks']);
            });


            client.client.multi(redisCommands).exec(function(err, replies){
                if (err){
                    console.log('error with getting hashrate stats ' + JSON.stringify(err));
                    callback(err);
                }
                else{
                    for(var i = 0; i < replies.length; i += commandsPerCoin){
                        var coinStats = {
                            coinName: client.coins[i / commandsPerCoin | 0],
                            hashrates: replies[i + 1],
                            poolStats: replies[i + 2],
                            poolPendingBlocks: replies[i + 3]
                        };
                        allCoinStats.push(coinStats)

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

            allCoinStats.forEach(function(coinStats){
                coinStats.workers = {};
                coinStats.shares = 0;
                coinStats.hashrates.forEach(function(ins){
                    var parts = ins.split(':');
                    var workerShares = parseInt(parts[0]);
                    coinStats.shares += workerShares;
                    var worker = parts[1];
                    if (worker in coinStats.workers)
                        coinStats.workers[worker] += workerShares
                    else
                        coinStats.workers[worker] = workerShares
                });
                coinStats.hashrate = (coinStats.shares * 4294967296 / portalConfig.website.hashrateWindow) / 100000000 | 0;
                delete coinStats.hashrates;
                portalStats.global.hashrate += coinStats.hashrate;
                portalStats.global.workers += Object.keys(coinStats.workers).length;
            });
            _this.stats = portalStats;
            callback();
        });

    };
};


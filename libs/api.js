var redis = require('redis');
var async = require('async');

var os = require('os');


module.exports = function(logger, poolConfigs){

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

    //Every 10 minutes clear out old hashrate stats for each coin from redis
    var clearExpiredHashrates = function(){
        redisClients.forEach(function(client){
            var tenMinutesAgo = (Date.now() / 1000 | 0) - (60 * 10);
            var redisCommands = client.coins.map(function(coin){
                return ['zremrangebyscore', coin + '_hashrate', '-inf', tenMinutesAgo];
            });
            client.client.multi(redisCommands).exec(function(err, replies){
                if (err)
                    console.log('error with clearing old hashrates ' + JSON.stringify(err));
            });
        });
    };
    setInterval(clearExpiredHashrates, 10 * 60 * 1000);
    clearExpiredHashrates();


    this.stats = {};


    this.getStats = function(callback){

        async.map(redisClients, function(client, callback){
            var tenMinutesAgo = (Date.now() / 1000 | 0) - (60 * 10);
            var redisCommands = client.coins.map(function(coin){
                return ['zrangebyscore', coin + '_hashrate', tenMinutesAgo, '+inf'];
            });
            client.client.multi(redisCommands).exec(function(err, replies){
                if (err){
                    console.log('error with getting hashrate stats ' + JSON.stringify(err));
                    callback(err);
                }
                else{
                    var replyObj = {};
                    for(var i = 0; i < replies.length; i++){
                        replyObj[client.coins[i]] = replies[i];
                    }
                    callback(null, replyObj);
                }
            });
        }, function(err, results){

            var portalStats = {
                global:{
                    workers: 0,
                    shares: 0
                },
                pools:{

                }
            };

            results.forEach(function(r){
                var coin = Object.keys(r)[0];
                var coinStats = {workers: {}, shares: 0};
                r[coin].forEach(function(ins){
                    var parts = ins.split(':');
                    var workerShares = parseInt(parts[0]);;
                    coinStats.shares += workerShares
                    var worker = parts[1];
                    if (worker in coinStats.workers)
                        coinStats.workers[worker] += workerShares
                    else
                        coinStats.workers[worker] = workerShares
                });
                portalStats.pools[coin] = coinStats;
                portalStats.global.shares += coinStats.shares;
                portalStats.global.workers += Object.keys(coinStats.workers).length;
            });

            _this.stats = portalStats;
            callback();
        });

        /*
        { global: {

        }

         */

        //get stats like hashrate and in/valid shares/blocks and workers in current round

    };
};


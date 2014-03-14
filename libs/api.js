var redis = require('redis');
var os = require('os');


module.exports = function(logger, poolConfigs){

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

    this.getStats = function(callback){

        //get stats like hashrate and in/valid shares/blocks and workers in current round

    };
};


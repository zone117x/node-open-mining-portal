var redis = require('redis');
var async = require('async');

var stats = require('./stats.js');

module.exports = function(logger, portalConfig, poolConfigs){


    var _this = this;

    var portalStats = this.stats = new stats(logger, portalConfig, poolConfigs);

    this.liveStatConnections = {};

    this.handleApiRequest = function(req, res, next){
        switch(req.params.method){
            case 'stats':
                res.end(portalStats.statsString);
                return;
            case 'pool_stats':
                res.end(JSON.stringify(portalStats.statPoolHistory));
                return;
            case 'live_stats':
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                res.write('\n');
                var uid = Math.random().toString();
                _this.liveStatConnections[uid] = res;
                req.on("close", function() {
                    delete _this.liveStatConnections[uid];
                });

                return;
            case 'balances':
		var coin=require('url').parse(req.url, true).query.coin;
		var address=require('url').parse(req.url, true).query.address;
		logger.error("egm","mej",'coin: '+coin);
		var callback=null;
		var processingConfig=poolConfigs[coin].shareProcessing.internal;
                redisClient = redis.createClient(processingConfig.redis.port, processingConfig.redis.host);
var workers=[address];
redisClient.hmget([coin + '_balances'].concat(workers), function(error, results){
		res.end(JSON.stringify((parseInt(results[0]) || 0)*0.00000001));
                    if (error ){
                        logger.error("meh", "meg", 'Check finished - redis error with multi get balances ' + JSON.stringify(error));
                        return;
                    }
                if (callback) {
                    callback();
                    callback = null;
                    return;
                }
		
                logger.debug("mm","mm", 'Connected to redis at '
                    + processingConfig.redis.host + ':' + processingConfig.redis.port + ' for balance checking');
});
return;
            default:
                next();
        }
    };


    this.handleAdminApiRequest = function(req, res, next){
        switch(req.params.method){
            case 'pools': {
                res.end(JSON.stringify({result: poolConfigs}));
                return;
            }
            default:
                next();
        }
    };

};

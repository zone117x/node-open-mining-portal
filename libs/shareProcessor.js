var events = require('events');
var cluster = require('cluster');

var redis = require('redis');

var processor = module.exports = function processor(logger){

    var _this = this;

    var client;

    function handleShare(data){
        var shareData = data.share;
        var coin = data.coin;
        client.hincrby([coin + ':' + shareData.height, shareData.worker, shareData.difficulty], function(error, result){
            if (error)
                logger.logError('shareProcessor', 'database', 'could not store worker share')
        });
    }

    function handleBlock(data){
        var requiredConfirmations = data.confirmations;
        //setInterval where we check for block confirmations
        //probably create our own rpc interface for each pool
    }

    this.init = function(){

        client = redis.createClient();

        client.on("error", function (err) {
            logger.logError('shareProcessor', 'database', 'Redis client had an error: ' + err);
        });

        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', function(data){
                switch(data.type){
                    case 'share':
                        handleShare(data);
                        break;
                    case 'block':
                        handleBlock(data)
                        break;
                }
            });
        });
    }
};


processor.prototype.__proto__ = events.EventEmitter.prototype;

var events   = require('events');
var redis    = require('redis');

var listener = module.exports = function listener(options){

    var _this = this;
    var redisConnection;

    var emitLog = function(text){
        _this.emit('log', text);
    };


    this.start = function(){
        redisConnection = redis.createClient(options.redisPort, options.redisHost);
        redisConnection.on("pmessage", function (pattern, channel, message) {
            var coinname = channel.split(':')[1];
            var blockhash = message;
            //emitLog("Redis: Received block for "+coinname+" - hash: "+blockhash);
            _this.emit('hash', {
                "coin" : coinname,
                "hash" : blockhash
            });
        });
        redisConnection.on('connect', function (err, data) {
            emitLog("Redis connected"); 
        });
        redisConnection.psubscribe(options.psubscribeKey);
        emitLog("Connecting to redis!");
    }



};

listener.prototype.__proto__ = events.EventEmitter.prototype;

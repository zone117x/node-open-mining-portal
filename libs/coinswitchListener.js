var events = require('events');
var net = require('net');

var listener = module.exports = function listener(options){

    var _this = this;

    var emitLog = function(text){
        _this.emit('log', text);
    };


    this.start = function(){
        if (!options || !options.enabled){
            emitLog('Coinswitch listener disabled');
            return;
        }

        var coinswitchServer = net.createServer(function(c) {

            emitLog('Coinswitch listener has incoming connection');
            var data = '';
            try {
                c.on('data', function (d) {
                    emitLog('Coinswitch listener received switch request');
                    data += d;
                    if (data.slice(-1) === '\n') {
                        c.end();
                    }
                });
                c.on('end', function () {

                    var message = JSON.parse(data);
                    if (message.password === options.password) {
                        _this.emit('switchcoin', message);
                    }
                    else
                        emitLog('Coinswitch listener received notification with incorrect password');

                });
            }
            catch(e){
                emitLog('Coinswitch listener failed to parse message ' + data);
            }

        });
        coinswitchServer.listen(options.port, function() {
            emitLog('Coinswitch notify listener server started on port ' + options.port)
        });

        emitLog("Coinswitch listener is enabled, starting server on port " + options.port);
    }

};

listener.prototype.__proto__ = events.EventEmitter.prototype;

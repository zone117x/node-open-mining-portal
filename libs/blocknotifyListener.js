var events = require('events');
var net = require('net');

var listener = module.exports = function listener(options){

    var _this = this;

    var emitLog = function(text){
        _this.emit('log', text);
    };


    this.start = function(){
        if (!options || !options.enabled){
            emitLog('Blocknotify listener disabled');
            return;
        }

        var blockNotifyServer = net.createServer(function(c) {

            emitLog('Block listener has incoming connection');
            var data = '';
            try {
                c.on('data', function (d) {
                    emitLog('Block listener received blocknotify data');
                    data += d;
                    if (data.slice(-1) === '\n') {
                        c.end();
                    }
                });
                c.on('end', function () {

                    emitLog('Block listener connection ended');

                    var message;

                    try{
                        message = JSON.parse(data);
                    }
                    catch(e){
                        emitLog('Block listener failed to parse message ' + data);
                        return;
                    }

                    if (message.password === options.password) {
                        _this.emit('hash', message);
                    }
                    else
                        emitLog('Block listener received notification with incorrect password');

                });
            }
            catch(e){
                emitLog('Block listener had an error: ' + e);
            }

        });
        blockNotifyServer.listen(options.port, function() {
            emitLog('Block notify listener server started on port ' + options.port)
        });

        emitLog("Block listener is enabled, starting server on port " + options.port);
    }



};

listener.prototype.__proto__ = events.EventEmitter.prototype;

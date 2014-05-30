var net = require('net');

var defaultPort = 17117;
var defaultHost = '127.0.0.1';

var args = process.argv.slice(2);
var params = [];
var options = {};

for(var i = 0; i < args.length; i++){
    if (args[i].indexOf('-') === 0 && args[i].indexOf('=') !== -1){
        var s = args[i].substr(1).split('=');
        options[s[0]] = s[1];
    }
    else
        params.push(args[i]);
}

var command = params.shift();



var client = net.connect(options.port || defaultPort, options.host || defaultHost, function () {
    client.write(JSON.stringify({
        command: command,
        params: params,
        options: options
    }) + '\n');
}).on('error', function(error){
    if (error.code === 'ECONNREFUSED')
        console.log('Could not connect to NOMP instance at ' + defaultHost + ':' + defaultPort);
    else
        console.log('Socket error ' + JSON.stringify(error));
}).on('data', function(data) {
    console.log(data.toString());
}).on('close', function () {
});
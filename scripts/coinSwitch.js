/*
This script demonstrates sending a coin switch request and can be invoked from the command line
with:

    "node coinSwitch.js localhost:8118 password %s"

where <%s> is the name of the coin proxy miners will be switched onto.

If the coin name is not configured, disabled or matches the existing proxy setting, no action
will be taken by NOMP on receipt of the message.
*/

var net       = require('net');
var config    = process.argv[2];
var parts     = config.split(':');
var host      = parts[0];
var port      = parts[1];
var password  = process.argv[3];
var coin      = process.argv[4];
var blockHash = process.argv[5];

var client = net.connect(port, host, function() {
    console.log('client connected');
    client.write(JSON.stringify({
        password: password,
        coin: coin,
    }) + '\n');
});

client.on('data', function(data) {
    console.log(data.toString());
    //client.end();
});

client.on('end', function() {
    console.log('client disconnected');
    //process.exit();
});

var fs = require('fs');

var Stratum = require('stratum-pool');



var timeLog = function(text, poolName){
    var desc = poolName ? '[' + poolName + '] ' : '';
    var time = new Date().toISOString();
    console.log(time + ': ' + desc + text);
};

var config = JSON.parse(fs.readFileSync("config.json"));


var stratum = new Stratum(config);
stratum.on('log', function(logText){
    timeLog(logText);
});


fs.readdirSync('coins').forEach(function(file){

    var coinOptions = JSON.parse(fs.readFileSync('coins/' + file, {encoding: 'utf8'}));

    var authorizeFN = function (ip, workerName, password, callback) {
        // Default implementation just returns true
        timeLog(coinOptions.name, "Authorize ["+ip+"] "+workerName+":"+password);
        callback({
            error: null,
            authorized: true,
            disconnect: false
        });
    };


    var pool = stratum.createPool(coinOptions, authorizeFN);
    pool.on('share', function(isValid, data){
        if (isValid)
            timeLog(coinOptions.name, "A new Valid share from " + data.client.workerName + " has arrived! - " + data.headerHex);
        else
            timeLog(coinOptions.name, "Invalid share form " + data.client.workerName + " ErrorCode: " + data.errorCode + " ErrorDescription: " + data.errorDescription);
    }).on('log', function(logText){
            timeLog(coinOptions.name, logText);
        });

});


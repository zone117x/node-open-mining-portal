var fs         = require('fs');
var dateFormat = require('dateformat');
var Stratum    = require('stratum-pool');
var PoolLogger = require('./libs/logutils.js');

var loggerInstance = new PoolLogger({
    'default': true,
    'keys': {
        'client'      : 'warning',
        'system'      : true,
        'submitblock' : true,
    }
});

var logDebug   = loggerInstance.logDebug;
var logWarning = loggerInstance.logWarning;
var logError   = loggerInstance.logError;

var config = JSON.parse(fs.readFileSync("config.json"));


var stratum = new Stratum(config);
stratum.on('log', function(logText){
    logDebug(logText);
});


fs.readdirSync('coins').forEach(function(file){

    var coinOptions = JSON.parse(fs.readFileSync('coins/' + file, {encoding: 'utf8'}));

    var authorizeFN = function (ip, workerName, password, callback) {
        // Default implementation just returns true
        logDebug(coinOptions.name, 'client', "Authorize ["+ip+"] "+workerName+":"+password);
        callback({
            error: null,
            authorized: true,
            disconnect: false
        });
    };


    var pool = stratum.createPool(coinOptions, authorizeFN);
    pool.on('share', function(isValid, data){
        if (isValid)
            logDebug(coinOptions.name, 'client',  "A new Valid share from " + data.client.workerName + " has arrived! - " + data.blockHeaderHex);
        else
            logDebug(coinOptions.name, 'client', "Invalid share form " + data.client.workerName + " ErrorCode: " + data.errorCode + " ErrorDescription: " + data.errorDescription);
    }).on('log', function(severity, logKey, logText) {
        if (severity == 'debug') {
            logDebug(coinOptions.name, logKey, logText);
        } else if (severity == 'warning') {
            logWarning(coinOptions.name, logKey, logText);
        } else if (severity == 'error') {
            logError(coinOptions.name, logKey, logText);
        }
    });

});


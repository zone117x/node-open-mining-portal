var fs         = require('fs');
var dateFormat = require('dateformat');
var Stratum    = require('stratum-pool');
var PoolLogger = require('./libs/logutils.js');

var loggerInstance = new PoolLogger({
    'default': true,
    'keys': {
        //'client'      : 'warning',
        'system'      : true,
        'submitblock' : true
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
    pool.on('share', function(isValidShare, isValidBlock, data){

        var shareData = JSON.stringify(data);

        if (isValidBlock)
            logDebug(coinOptions.name, 'client', 'Block found, share data: ' + shareData);
        else if (isValidShare)
            logDebug(coinOptions.name, 'client', 'Valid share submitted, share data: ' + shareData);
        else if (data.solution)
            logDebug(coinOptions.name, 'client', 'We thought a block solution was found but it was rejected by the daemon, share data: ' + shareData);
        else
            logDebug(coinOptions.name, 'client', 'Invalid share submitted, share data: ' + shareData)


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


var fs = require('fs');
var posix = require('posix');
var Stratum = require('stratum-pool');
var PoolLogger = require('./libs/logutils.js');

JSON.minify = JSON.minify || require("node-json-minify");


try{
    posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
}
catch(e){
    console.error(e);
}

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

var config = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: 'utf8'})));


var stratum = new Stratum(config);
stratum.on('log', function(logText){
    logDebug(logText);
});


var coinProfiles = (function(){
    var profiles = {};
    fs.readdirSync('coins').forEach(function(file){
        var coinProfile = JSON.parse(JSON.minify(fs.readFileSync('coins/' + file, {encoding: 'utf8'})));
        profiles[coinProfile.name.toLowerCase()] = coinProfile;
    });
    return profiles;
})();

fs.readdirSync('pool_configs').forEach(function(file){

    var poolOptions = JSON.parse(JSON.minify(fs.readFileSync('pool_configs/' + file, {encoding: 'utf8'})));
    if (poolOptions.disabled) return;

    if (!(poolOptions.coin.toLowerCase() in coinProfiles)){
        logError(poolOptions.coin, 'system', 'could not find coin profile');
        return;
    }

    poolOptions.coin = coinProfiles[poolOptions.coin.toLowerCase()];

    var authorizeFN = function (ip, workerName, password, callback) {
        // Default implementation just returns true
        logDebug(poolOptions.coin.name, 'client', "Authorize ["+ip+"] "+workerName+":"+password);
        callback({
            error: null,
            authorized: true,
            disconnect: false
        });
    };



    var pool = stratum.createPool(poolOptions, authorizeFN);
    pool.on('share', function(isValidShare, isValidBlock, data){

        var shareData = JSON.stringify(data);

        if (data.solution && !isValidBlock)
            logDebug(poolOptions.coin.name, 'client', 'We thought a block solution was found but it was rejected by the daemon, share data: ' + shareData);
        else if (isValidBlock)
            logDebug(poolOptions.coin.name, 'client', 'Block found, share data: ' + shareData);
        else if (isValidShare)
            logDebug(poolOptions.coin.name, 'client', 'Valid share submitted, share data: ' + shareData);
        else
            logDebug(poolOptions.coin.name, 'client', 'Invalid share submitted, share data: ' + shareData)


    }).on('log', function(severity, logKey, logText) {
        if (severity == 'debug') {
            logDebug(poolOptions.coin.name, logKey, logText);
        } else if (severity == 'warning') {
            logWarning(poolOptions.coin.name, logKey, logText);
        } else if (severity == 'error') {
            logError(poolOptions.coin.name, logKey, logText);
        }
    });
    pool.start();

});


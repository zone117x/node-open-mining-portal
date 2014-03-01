var fs = require('fs');
var os = require('os');
var cluster = require('cluster');


var posix = require('posix');
var Stratum = require('stratum-pool');
var PoolLogger = require('./libs/logutils.js');
var BlocknotifyListener = require('./libs/blocknotifyListener.js');

JSON.minify = JSON.minify || require("node-json-minify");



//Try to give process ability to handle 100k concurrent connections
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



if (cluster.isMaster){


    var config = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: 'utf8'})));

    //Read all coin profile json files from coins directory and build object where key is name of coin
    var coinProfiles = (function(){
        var profiles = {};
        fs.readdirSync('coins').forEach(function(file){
            var coinProfile = JSON.parse(JSON.minify(fs.readFileSync('coins/' + file, {encoding: 'utf8'})));
            profiles[coinProfile.name.toLowerCase()] = coinProfile;
        });
        return profiles;
    })();


    //Read all pool configs from pool_configs and join them with their coin profile
    var poolConfigs = (function(){
        var configs = [];
        fs.readdirSync('pool_configs').forEach(function(file){
            var poolOptions = JSON.parse(JSON.minify(fs.readFileSync('pool_configs/' + file, {encoding: 'utf8'})));
            if (poolOptions.disabled) return;
            if (!(poolOptions.coin.toLowerCase() in coinProfiles)){
                logError(poolOptions.coin, 'system', 'could not find coin profile');
                return;
            }
            poolOptions.coin = coinProfiles[poolOptions.coin.toLowerCase()];
            configs.push(poolOptions);
        });
        return configs;
    })();


    var serializedConfigs = JSON.stringify(poolConfigs);


    var numForks = (function(){
        if (!config.clustering || !config.clustering.enabled)
            return 1;
        if (config.clustering.forks === 'auto')
            return os.cpus().length;
        if (!config.clustering.forks || isNaN(config.clustering.forks))
            return 1;
        return config.clustering.forks;
    })();

    for (var i = 0; i < numForks; i++) {
        cluster.fork({
            fork: i,
            pools: serializedConfigs
        });
    }

    cluster.on('exit', function(worker, code, signal) {
        console.log('worker fork with PID ' + worker.process.pid + ' died');
    });


    //block notify options
    //setup block notify here and use IPC to tell appropriate pools
    var listener = new BlocknotifyListener(config.blockNotifyListener);
    listener.on('log', function(text){
        logDebug('blocknotify', 'system', text);
    });
    listener.on('hash', function(message){

        var serializedMessage = JSON.stringify({'blocknotify': message.hash});
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(serializedMessage);
        });

    });
    listener.start();

}

else{

    var poolConfigs = JSON.parse(process.env.pools);
    var fork = process.env.fork;

    var pools = [];

    //Handle blocknotify message from master process sent via IPC
    process.on('message', function(msg) {
        var message = JSON.parse(msg);
        if (message.blocknotify){
            for (var i = 0; i < pools.length; i++){
                if (pools[i].options.coin.name.toLowerCase() === message.coin.toLowerCase()){
                    pools[i].processBlockNotify(message.blockHash)
                    return;
                }
            }
        }
    });




    poolConfigs.forEach(function(poolOptions){

        var logIdentify = poolOptions.coin.name + ' (Fork ' + fork + ')';

        var authorizeFN = function (ip, workerName, password, callback) {
            // Default implementation just returns true
            logDebug(logIdentify, 'client', "Authorize [" + ip + "] " + workerName + ":" + password);
            callback({
                error: null,
                authorized: true,
                disconnect: false
            });
        };


        var pool = Stratum.createPool(poolOptions, authorizeFN);
        pool.on('share', function(isValidShare, isValidBlock, data){

            var shareData = JSON.stringify(data);

            if (data.solution && !isValidBlock)
                logDebug(logIdentify, 'client', 'We thought a block solution was found but it was rejected by the daemon, share data: ' + shareData);
            else if (isValidBlock)
                logDebug(logIdentify, 'client', 'Block found, share data: ' + shareData);
            else if (isValidShare)
                logDebug(logIdentify, 'client', 'Valid share submitted, share data: ' + shareData);
            else
                logDebug(logIdentify, 'client', 'Invalid share submitted, share data: ' + shareData)


        }).on('log', function(severity, logKey, logText) {
                if (severity == 'debug') {
                    logDebug(logIdentify, logKey, logText);
                } else if (severity == 'warning') {
                    logWarning(logIdentify, logKey, logText);
                } else if (severity == 'error') {
                    logError(logIdentify, logKey, logText);
                }
            });
        pool.start();
        pools.push(pool);
    });
}

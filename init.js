var fs = require('fs');
var os = require('os');
var cluster = require('cluster');


var posix = require('posix');
var PoolLogger = require('./libs/logutils.js');
var BlocknotifyListener = require('./libs/blocknotifyListener.js');
var ShareProcessor = require('./libs/shareProcessor.js');
var PoolWorker = require('./libs/poolWorker.js');

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
        logError('workerFork', 'system', 'fork with PID ' + worker.process.pid + ' died');
    });



    var shareProcessor = new ShareProcessor(loggerInstance);
    shareProcessor.init();



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

    var worker = new PoolWorker(loggerInstance);

}

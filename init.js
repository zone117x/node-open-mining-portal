var fs = require('fs');
var path = require('path');
var os = require('os');
var cluster = require('cluster');

var async = require('async');
var PoolLogger = require('./libs/logUtil.js');
var BlocknotifyListener = require('./libs/blocknotifyListener.js');
var CoinswitchListener = require('./libs/coinswitchListener.js');
var RedisBlocknotifyListener = require('./libs/redisblocknotifyListener.js');
var WorkerListener = require('./libs/workerListener.js');
var PoolWorker = require('./libs/poolWorker.js');
var PaymentProcessor = require('./libs/paymentProcessor.js');
var Website = require('./libs/website.js');

var algos = require('stratum-pool/lib/algoProperties.js');

JSON.minify = JSON.minify || require("node-json-minify");

if (!fs.existsSync('config.json')){
    console.log('config.json file does not exist. Read the installation/setup instructions.');
    return;
}

var portalConfig = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: 'utf8'})));


var logger = new PoolLogger({
    logLevel: portalConfig.logLevel
});




try {
    require('newrelic');
    if (cluster.isMaster)
        logger.debug('NewRelic', 'Monitor', 'New Relic initiated');
} catch(e) {}


//Try to give process ability to handle 100k concurrent connections
try{
    var posix = require('posix');
    try {
        posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
    }
    catch(e){
        if (cluster.isMaster)
            logger.warning('POSIX', 'Connection Limit', '(Safe to ignore) Must be ran as root to increase resource limits');
    }
}
catch(e){
    if (cluster.isMaster)
        logger.debug('POSIX', 'Connection Limit', '(Safe to ignore) POSIX module not installed and resource (connection) limit was not raised');
}



if (cluster.isWorker){
    
    switch(process.env.workerType){
        case 'pool':
            new PoolWorker(logger);
            break;
        case 'paymentProcessor':
            new PaymentProcessor(logger);
            break;
        case 'website':
            new Website(logger);
            break;
    }

    return;
} 


//Read all pool configs from pool_configs and join them with their coin profile
var buildPoolConfigs = function(){
    var configs = {};
    var configDir = 'pool_configs/';
    fs.readdirSync(configDir).forEach(function(file){
        if (!fs.existsSync(configDir + file) || path.extname(configDir + file) !== '.json') return;
        var poolOptions = JSON.parse(JSON.minify(fs.readFileSync(configDir + file, {encoding: 'utf8'})));
        if (!poolOptions.enabled) return;
        var coinFilePath = 'coins/' + poolOptions.coin;
        if (!fs.existsSync(coinFilePath)){
            logger.error('Master', poolOptions.coin, 'could not find file: ' + coinFilePath);
            return;
        }

        var coinProfile = JSON.parse(JSON.minify(fs.readFileSync(coinFilePath, {encoding: 'utf8'})));
        poolOptions.coin = coinProfile;
        configs[poolOptions.coin.name.toLowerCase()] = poolOptions;

        if (!(coinProfile.algorithm in algos)){
            logger.error('Master', coinProfile.name, 'Cannot run a pool for unsupported algorithm "' + coinProfile.algorithm + '"');
            delete configs[poolOptions.coin.name.toLowerCase()];
        }

    });
    return configs;
};



var spawnPoolWorkers = function(portalConfig, poolConfigs){

    Object.keys(poolConfigs).forEach(function(coin){
        var p = poolConfigs[coin];
        var internalEnabled = p.shareProcessing && p.shareProcessing.internal && p.shareProcessing.internal.enabled;
        var mposEnabled = p.shareProcessing && p.shareProcessing.mpos && p.shareProcessing.mpos.enabled;

        if (!internalEnabled && !mposEnabled){
            logger.error('Master', coin, 'Share processing is not configured so a pool cannot be started for this coin.');
            delete poolConfigs[coin];
        }
    });

    if (Object.keys(poolConfigs).length === 0){
        logger.warning('Master', 'PoolSpawner', 'No pool configs exists or are enabled in pool_configs folder. No pools spawned.');
        return;
    }

    var serializedConfigs = JSON.stringify(poolConfigs);

    var numForks = (function(){
        if (!portalConfig.clustering || !portalConfig.clustering.enabled)
            return 1;
        if (portalConfig.clustering.forks === 'auto')
            return os.cpus().length;
        if (!portalConfig.clustering.forks || isNaN(portalConfig.clustering.forks))
            return 1;
        return portalConfig.clustering.forks;
    })();


    var createPoolWorker = function(forkId){
        var worker = cluster.fork({
            workerType: 'pool',
            forkId: forkId,
            pools: serializedConfigs,
            portalConfig: JSON.stringify(portalConfig)
        });
        worker.on('exit', function(code, signal){
            logger.error('Master', 'PoolSpanwer', 'Fork ' + forkId + ' died, spawning replacement worker...');
            setTimeout(function(){
                createPoolWorker(forkId);
            }, 2000);
        });
    };

    var i = 0;
    var spawnInterval = setInterval(function(){
        createPoolWorker(i);
        i++;
        if (i === numForks){
            clearInterval(spawnInterval);
            logger.debug('Master', 'PoolSpawner', 'Spawned ' + Object.keys(poolConfigs).length + ' pool(s) on ' + numForks + ' thread(s)');
        }
    }, 250);

};


var startWorkerListener = function(poolConfigs){
    var workerListener = new WorkerListener(logger, poolConfigs);
    workerListener.init();
};


var startBlockListener = function(portalConfig){
    //block notify options
    //setup block notify here and use IPC to tell appropriate pools
    var listener = new BlocknotifyListener(portalConfig.blockNotifyListener);
    listener.on('log', function(text){
        logger.debug('Master', 'Blocknotify', text);
    });
    listener.on('hash', function(message){

        var ipcMessage = {type:'blocknotify', coin: message.coin, hash: message.hash};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });

    });
    listener.start();
};


//
// Receives authenticated events from coin switch listener and triggers proxy
// to swtich to a new coin.  
//
var startCoinswitchListener = function(portalConfig){
    var listener = new CoinswitchListener(portalConfig.coinSwitchListener);
    listener.on('log', function(text){
        logger.debug('Master', 'Coinswitch', text);
    });
    listener.on('switchcoin', function(message){

        var ipcMessage = {type:'blocknotify', coin: message.coin, hash: message.hash};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });
        var ipcMessage = { 
		    type:'switch', 
			coin: message.coin.toLowerCase()
		};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });

    });
    listener.start();

/*
if !cluster.isWorker
else {
    var coinNames = ['Emoticoin','Infinitecoin'];
    var curIndex = 0;
    setInterval(function () {
        var newCoinName = coinNames[++curIndex % coinNames.length];
        console.log("SWITCHING to " + newCoinName);
        var ipcMessage = { 
		    type:'switch', 
			coin: newCoinName
		};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });
    }, 30000);
} 
*/

};

var startRedisBlockListener = function(portalConfig){
    //block notify options
    //setup block notify here and use IPC to tell appropriate pools

    if (!portalConfig.redisBlockNotifyListener.enabled) return;

    var listener = new RedisBlocknotifyListener(portalConfig.redisBlockNotifyListener);
    listener.on('log', function(text){
        logger.debug('Master', 'blocknotify', text);
    }).on('hash', function (message) {
        var ipcMessage = {type:'blocknotify', coin: message.coin, hash: message.hash};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });
    });
    listener.start();
};


var startPaymentProcessor = function(poolConfigs){

    var enabledForAny = false;
    for (var pool in poolConfigs){
        var p = poolConfigs[pool];
        var enabled = p.enabled && p.shareProcessing && p.shareProcessing.internal && p.shareProcessing.internal.enabled;
        if (enabled){
            enabledForAny = true;
            break;
        }
    }

    if (!enabledForAny)
        return;

    var worker = cluster.fork({
        workerType: 'paymentProcessor',
        pools: JSON.stringify(poolConfigs)
    });
    worker.on('exit', function(code, signal){
        logger.error('Master', 'Payment Processor', 'Payment processor died, spawning replacement...');
        setTimeout(function(){
            startPaymentProcessor(poolConfigs);
        }, 2000);
    });
};


var startWebsite = function(portalConfig, poolConfigs){

    if (!portalConfig.website.enabled) return;

    var worker = cluster.fork({
        workerType: 'website',
        pools: JSON.stringify(poolConfigs),
        portalConfig: JSON.stringify(portalConfig)
    });
    worker.on('exit', function(code, signal){
        logger.error('Master', 'Website', 'Website process died, spawning replacement...');
        setTimeout(function(){
            startWebsite(portalConfig, poolConfigs);
        }, 2000);
    });
};


(function init(){

    var poolConfigs = buildPoolConfigs();

    spawnPoolWorkers(portalConfig, poolConfigs);

    startPaymentProcessor(poolConfigs);

    startBlockListener(portalConfig);

    startCoinswitchListener(portalConfig);

    startRedisBlockListener(portalConfig);

    startWorkerListener(poolConfigs);

    startWebsite(portalConfig, poolConfigs);

})();

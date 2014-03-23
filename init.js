var fs = require('fs');
var os = require('os');
var cluster = require('cluster');


var async                    = require('async');
var posix                    = require('posix');
var PoolLogger               = require('./libs/logUtil.js');
var BlocknotifyListener      = require('./libs/blocknotifyListener.js');
var RedisBlocknotifyListener = require('./libs/redisblocknotifyListener.js');
var WorkerListener           = require('./libs/workerListener.js');
var PoolWorker               = require('./libs/poolWorker.js');
var PaymentProcessor         = require('./libs/paymentProcessor.js');
var Website                  = require('./libs/website.js');
JSON.minify = JSON.minify || require("node-json-minify");

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
    posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
}
catch(e){
    logger.warning('POSIX', 'Connection Limit', '(Safe to ignore) Must be ran as root to increase resource limits');
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
} /* else {
    var coinNames = ['alphacoin','frankocoin','emerald','kittehcoin'];
    var curIndex = 0;
    setInterval(function () {
        var newCoinName = coinNames[++curIndex % coinNames.length];
        console.log("SWITCHING to "+newCoinName);
        var ipcMessage = {type:'switch', coin: newCoinName};
        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].send(ipcMessage);
        });
    }, 20000);
} */



//Read all pool configs from pool_configs and join them with their coin profile
var buildPoolConfigs = function(){
    var configs = {};
    fs.readdirSync('pool_configs').forEach(function(file){
        var poolOptions = JSON.parse(JSON.minify(fs.readFileSync('pool_configs/' + file, {encoding: 'utf8'})));
        if (poolOptions.disabled) return;
        var coinFilePath = 'coins/' + poolOptions.coin;
        if (!fs.existsSync(coinFilePath)){
            logger.error('Master', poolOptions.coin, 'could not find file: ' + coinFilePath);
            return;
        }

        var coinProfile = JSON.parse(JSON.minify(fs.readFileSync(coinFilePath, {encoding: 'utf8'})));
        poolOptions.coin = coinProfile;
        configs[poolOptions.coin.name] = poolOptions;
    });
    return configs;
};



var spawnPoolWorkers = function(portalConfig, poolConfigs){
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
            workerType   : 'pool',
            forkId       : forkId,
            pools        : serializedConfigs,
            portalConfig : JSON.stringify(portalConfig)
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
            logger.debug('Master', 'PoolSpawner', 'Spawned pools for all ' + numForks + ' configured forks');
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

    startRedisBlockListener(portalConfig);

    startWorkerListener(poolConfigs);

    startWebsite(portalConfig, poolConfigs);

})();

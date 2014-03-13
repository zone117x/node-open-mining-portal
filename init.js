var fs = require('fs');
var os = require('os');
var cluster = require('cluster');


var posix = require('posix');
var PoolLogger = require('./libs/logutils.js');
var BlocknotifyListener = require('./libs/blocknotifyListener.js');
var WorkerListener = require('./libs/workerListener.js');
var PoolWorker = require('./libs/poolWorker.js');
var PaymentProcessor = require('./libs/paymentProcessor.js');
var Website = require('./libs/website.js');

JSON.minify = JSON.minify || require("node-json-minify");




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


//Try to give process ability to handle 100k concurrent connections
try{
    posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
}
catch(e){
    logWarning('posix', 'system', '(Safe to ignore) Must be ran as root to increase resource limits');
}



if (cluster.isWorker){

    switch(process.env.workerType){
        case 'pool':
            new PoolWorker(loggerInstance);
            break;
        case 'paymentProcessor':
            new PaymentProcessor(loggerInstance);
            break;
        case 'website':
            new Website(loggerInstance);
            break;
    }

    return;
}



//Read all pool configs from pool_configs and join them with their coin profile
var buildPoolConfigs = function(){
    var configs = {};
    fs.readdirSync('pool_configs').forEach(function(file){
        var poolOptions = JSON.parse(JSON.minify(fs.readFileSync('pool_configs/' + file, {encoding: 'utf8'})));
        if (poolOptions.disabled) return;
        var coinFilePath = 'coins/' + poolOptions.coin;
        if (!fs.existsSync(coinFilePath)){
            logError(poolOptions.coin, 'system', 'could not find file: ' + coinFilePath);
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
            workerType: 'pool',
            forkId: forkId,
            pools: serializedConfigs
        });
        worker.on('exit', function(code, signal){
            logError('poolWorker', 'system', 'Fork ' + forkId + ' died, spawning replacement worker...');
            setTimeout(function(){
                createPoolWorker(forkId);
            }, 2000);
        });
    };

    for (var i = 0; i < numForks; i++) {
        createPoolWorker(i);
    }

};


var startWorkerListener = function(poolConfigs){
    var workerListener = new WorkerListener(loggerInstance, poolConfigs);
    workerListener.init();
};


var startBlockListener = function(portalConfig){
    //block notify options
    //setup block notify here and use IPC to tell appropriate pools
    var listener = new BlocknotifyListener(portalConfig.blockNotifyListener);
    listener.on('log', function(text){
        logDebug('blocknotify', 'system', text);
    });
    listener.on('hash', function(message){

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
        logError('paymentProcessor', 'system', 'Payment processor died, spawning replacement...');
        setTimeout(function(){
            startPaymentProcessor.apply(null, arguments);
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
        logError('website', 'system', 'Website process died, spawning replacement...');
        setTimeout(function(){
            startWebsite.apply(null, arguments);
        }, 2000);
    });
};



(function init(){
    var portalConfig = JSON.parse(JSON.minify(fs.readFileSync("config.json", {encoding: 'utf8'})));

    var poolConfigs = buildPoolConfigs();

    spawnPoolWorkers(portalConfig, poolConfigs);

    startPaymentProcessor(poolConfigs);

    startBlockListener(portalConfig);

    startWorkerListener(poolConfigs);

    startWebsite(portalConfig, poolConfigs);

})();
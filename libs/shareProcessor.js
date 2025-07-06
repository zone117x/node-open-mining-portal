const redis = require('redis');

/*
This module deals with handling shares when in internal payment processing mode. It connects to a redis
database and inserts shares with the database structure of:

key: coin_name + ':' + block_height
value: a hash with..
        key:

 */

function roundTo(n, digits = 0) {
    var multiplicator = Math.pow(10, digits);
    n = parseFloat((n * multiplicator).toFixed(11));
    var test =(Math.round(n) / multiplicator);
    return +(test.toFixed(digits));
}

module.exports = function(logger, poolConfig){
    var redisConfig = poolConfig.redis;
    var coin = poolConfig.coin.name;

    var forkId = process.env.forkId;
    var logSystem = 'Pool';
    var logComponent = coin;
    var logSubCat = 'Thread ' + (parseInt(forkId) + 1);

    var connection = redis.createClient(redisConfig.port, redisConfig.host);

    connection.on('ready', function(){
        logger.debug(logSystem, logComponent, logSubCat, 'Share processing setup with redis (' + redisConfig.host +
            ':' + redisConfig.port  + ')');
    });
    connection.on('error', function(err){
        logger.error(logSystem, logComponent, logSubCat, 'Redis client had an error: ' + JSON.stringify(err))
    });
    connection.on('end', function(){
        logger.error(logSystem, logComponent, logSubCat, 'Connection to redis database has been ended');
    });

    connection.info(function(error, response){
        if (error){
            logger.error(logSystem, logComponent, logSubCat, 'Redis version check failed');
            return;
        }
        var parts = response.split('\r\n');
        var version;
        var versionString;
        for (var i = 0; i < parts.length; i++){
            if (parts[i].indexOf(':') !== -1){
                var valParts = parts[i].split(':');
                if (valParts[0] === 'redis_version'){
                    versionString = valParts[1];
                    version = parseFloat(versionString);
                    break;
                }
            }
        }
        if (!version){
            logger.error(logSystem, logComponent, logSubCat, 'Could not detect redis version - but be super old or broken');
        }
        else if (version < 2.6){
            logger.error(logSystem, logComponent, logSubCat, "You're using redis version " + versionString + " the minimum required version is 2.6. Follow the damn usage instructions...");
        }
    });

    this.handleShare = async function(isValidShare, isValidBlock, shareData) {
    try {
        var redisCommands = [];

        const multiAsync = (commands) => {
            return new Promise((resolve, reject) => {
                connection.multi(commands).exec((err, replies) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(replies);
                    }
                })
            })
        }

        const workerAddress = String(shareData.worker).split(".")[0];

        const dateNow = Date.now();

        const isBlockShare = isValidShare && shareData.blockHash

        /**
         * todo: Need to fix our blockTemplate to use redis since it allows miners connected with different stratum port to submit duplicated shares
         * we validate them here
         */
        let [lastShareTime, lastStartTime, isDuplicatedShares, isDuplicatedBlock] = await multiAsync([
            ['hget', `${coin}:lastShareTimes`, workerAddress],
            ['hget', `${coin}:lastStartTimes`, workerAddress],
            ['hexists', `${coin}:shares:seralized`, shareData.shareSerialized || ''],
            ['hexists', `${coin}:shares:blockHash`, shareData.blockHash || ''],
        ]);

        lastShareTime = Number(lastShareTime);
        lastStartTime = Number(lastStartTime);

        // did they just join in this round?
        if (!lastStartTime) {
            logger.debug(logSystem, logComponent, logSubCat, `PPLNT: ${workerAddress} joined`);
            redisCommands.push(['hset', `${coin}:lastStartTimes`, workerAddress, dateNow]);
            lastShareTime = dateNow;
            lastStartTime = dateNow;
        }

        // if its been less than 15 minutes since last share was submitted
        const timeChangeSec = roundTo(Math.max(dateNow - lastShareTime, 0) / 1000, 4);
        if (timeChangeSec < 900) {
            // loyal miner keeps mining :)
            redisCommands.push(['hincrbyfloat', coin + ':shares:timesCurrent', workerAddress, timeChangeSec]);
        } else {
            // they just re-joined the pool
            logger.debug(logSystem, logComponent, logSubCat, `PPLNT: ${workerAddress} rejoined`);
            redisCommands.push(['hset', `${coin}:lastStartTimes`, workerAddress, dateNow]);
        }

        // track last time share
        redisCommands.push(['hset', `${coin}:lastShareTimes`, workerAddress, dateNow]);

        /**
         * Prevent miner to submit a duplicated block (duplicated height would be okay since we filter them on paymentProcessor)
         */
        if (isBlockShare && isDuplicatedBlock) {
            isValidShare = false;
            isValidBlock = false;
            logger.warning(logSystem, logComponent, logSubCat, `Miner ${shareData.worker} has submitted a duplicated block ${shareData.blockHash}, ignoring it`);
        } else if (!isBlockShare && isDuplicatedShares) {
            isValidShare = false;
            logger.warning(logSystem, logComponent, logSubCat, `Miner ${shareData.worker} has submitted a duplicated shares ${shareData.shareSerialized}, ignoring it`);
        }

        if (isValidShare) {
            redisCommands.push(['hincrbyfloat', coin + ':shares:roundCurrent', shareData.worker, shareData.difficulty]);
            redisCommands.push(['hincrby', coin + ':stats', 'validShares', 1]);
            redisCommands.push(['hset', `${coin}:shares:seralized`, shareData.shareSerialized, shareData.worker]);
        } else {
            redisCommands.push(['hincrby', coin + ':stats', 'invalidShares', 1]);
        }

        /* Stores share diff, worker, and unique value with a score that is the timestamp. Unique value ensures it
           doesn't overwrite an existing entry, and timestamp as score lets us query shares from last X minutes to
           generate hashrate for each worker and pool. */
        var hashrateData = [ isValidShare ? shareData.difficulty : -shareData.difficulty, shareData.worker, dateNow / 1000 | 0];
        redisCommands.push(['zadd', coin + ':hashrate', dateNow / 1000 | 0, hashrateData.join(':')]);

        /**
         * Prevent miner to submit a duplicated block (duplicated height would be okay since we filter them on paymentProcessor)
         */

        if (isValidBlock) {
            redisCommands.push(['rename', coin + ':shares:roundCurrent', coin + ':shares:round' + shareData.height]);
            redisCommands.push(['rename', coin + ':shares:timesCurrent', coin + ':shares:times' + shareData.height]);
            redisCommands.push(['sadd', coin + ':blocksPending', [shareData.blockHash, shareData.txHash, shareData.height, shareData.worker, dateNow / 1000 | 0].join(':')]);
            redisCommands.push(['hincrby', coin + ':stats', 'validBlocks', 1]);
            redisCommands.push(['hset', `${coin}:shares:blockHash`, shareData.blockHash, shareData.worker]);
            redisCommands.push(['del', `${coin}:shares:seralized`]);
        } else if (shareData.blockHash) {
            redisCommands.push(['hincrby', coin + ':stats', 'invalidBlocks', 1]);
        }

        await multiAsync(redisCommands);

        logger.debug(logSystem, logComponent, logSubCat, `Updated share in ${Date.now() - dateNow} ms`);
    } catch (error) {
        logger.error(logSystem, logComponent, logSubCat, 'Error with share processor multi');
        console.log(error);
    }
    };
};

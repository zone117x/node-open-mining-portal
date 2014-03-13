var os = require('os');


module.exports = function(logger, poolConfigs){

    //Every 10 minutes clear out old hashrate stat data from redis
    setInterval(function(){
        var tenMinutesAgo = (Date.now() / 1000 | 0) - (60 * 10);
        connection.zremrangebyscore([coin + '_hashrate', '-inf', tenMinutesAgo]);
    }, 10 * 60 * 1000);


};


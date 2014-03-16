var dateFormat = require('dateformat');
/*
var defaultConfiguration = {
    'default': true,
    'keys': {
        'client'      : 'warning',
        'system'      : true,
        'submitblock' : true,
    }
};
*/

var severityToInt = function(severity) {
    switch(severity) {
        case 'debug':
            return 10;
        case 'warning':
            return 20;
        case 'error':
            return 30;
        default:
            console.log("Unknown severity "+severity);
            return 1000;
    }
}
var getSeverityColor = function(severity) {
    switch(severity) {
        case 'debug':
            return 32;
        case 'warning':
            return 33;
        case 'error':
            return 31;
        default:
            console.log("Unknown severity "+severity);
            return 31;
    }
}

var PoolLogger = function (configuration) {

    var logLevelInt = severityToInt(configuration.logLevel);

    // privates
    var shouldLog = function(key, severity) {
        var severity = severityToInt(severity);
        return severity >= logLevelInt;
    };

    var log = function(severity, key, poolName, text) {
        if (!shouldLog(key, severity))
            return;

        var desc = poolName ? '[' + poolName + '] ' : '';
        console.log(
            '\u001b[' + getSeverityColor(severity) + 'm' +
            dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss') +
            " [" + key + "]" + '\u001b[39m: ' + "\t" +
            desc + text
        );
    }

    // public

    this.logDebug = function(poolName, logKey, text){
        log('debug', logKey, poolName, text);
    }

    this.logWarning = function(poolName, logKey, text) {
        log('warning', logKey, poolName, text);   
    }

    this.logError = function(poolName, logKey, text) {
        log('error', logKey, poolName, text);   
    }
}

module.exports = PoolLogger;
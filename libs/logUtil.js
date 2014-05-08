var dateFormat = require('dateformat');
var colors = require('colors');


var severityToColor = function(severity, text) {
    switch(severity) {
        case 'special':
            return text.cyan.underline;
        case 'debug':
            return text.green;
        case 'warning':
            return text.yellow;
        case 'error':
            return text.red;
        default:
            console.log("Unknown severity " + severity);
            return text.italic;
    }
};

var severityValues = {
    'debug': 1,
    'warning': 2,
    'error': 3,
    'special': 4
};


var PoolLogger = function (configuration) {


    var logLevelInt = severityValues[configuration.logLevel];
    var logColors = configuration.logColors;



    var log = function(severity, system, component, text, subcat) {

        if (severityValues[severity] < logLevelInt) return;

        if (subcat){
            var realText = subcat;
            var realSubCat = text;
            text = realText;
            subcat = realSubCat;
        }

        var entryDesc = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss') + ' [' + system + ']\t';
        if (logColors) {
            entryDesc = severityToColor(severity, entryDesc);

            var logString =
                    entryDesc +
                    ('[' + component + '] ').italic;

            if (subcat)
                logString += ('(' + subcat + ') ').bold.grey;

            logString += text.grey;
        }
        else {
            var logString =
                    entryDesc +
                    '[' + component + '] ';

            if (subcat)
                logString += '(' + subcat + ') ';

            logString += text;
        }

        console.log(logString);


    };

    // public

    var _this = this;
    Object.keys(severityValues).forEach(function(logType){
        _this[logType] = function(){
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(logType);
            log.apply(this, args);
        };
    });
};

module.exports = PoolLogger;
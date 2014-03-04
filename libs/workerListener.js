var events = require('events');
var cluster = require('cluster');

var MposCompatibility = require('./mposCompatibility.js');
var ShareProcessor = require('./shareProcessor.js');


var processor = module.exports = function processor(logger, poolConfigs){

    var _this = this;


    var mposCompat = new MposCompatibility(logger, poolConfigs);
    var shareProcessor = new ShareProcessor(logger, poolConfigs);


    this.init = function(){

        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', function(data){

                var shareProcessing = poolConfigs[data.coin].shareProcessing;

                switch(data.type){
                    case 'share':
                        if (shareProcessing.internal.enabled)
                            shareProcessor.handleShare(data);
                        if (shareProcessing.mpos.enabled)
                            mposCompat.handleShare(data);
                        break;
                    case 'difficultyUpdate':
                        if (shareProcessing.mpos.enabled)
                            mposCompat.handleDifficultyUpdate(data);
                        break;
                    case 'block':
                        if (shareProcessing.internal.enabled)
                            shareProcessor.handleBlock(data);
                        break;
                    case 'mposAuth':
                        mposCompat.handleAuth(data);
                        break;
                }
            });
        });
    }
};


processor.prototype.__proto__ = events.EventEmitter.prototype;

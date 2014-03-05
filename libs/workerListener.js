var events = require('events');
var cluster = require('cluster');

var MposCompatibility = require('./mposCompatibility.js');
var ShareProcessor = require('./shareProcessor.js');


var processor = module.exports = function processor(logger, poolConfigs){

    var _this = this;


    this.init = function(){

        Object.keys(cluster.workers).forEach(function(id) {
            cluster.workers[id].on('message', function(data){
                switch(data.type){

                }
            });
        });
    }
};


processor.prototype.__proto__ = events.EventEmitter.prototype;

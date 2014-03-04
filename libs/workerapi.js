var express = require('express');
var os = require('os');


function workerapi(listen) {
	var _this = this;
	var app = express();
	var counters = {
		validShares   : 0,
		validBlocks   : 0,
		invalidShares : 0
	};

	var lastEvents = {
		lastValidShare   : 0 ,
		lastValidBlock   : 0,
		lastInvalidShare : 0
	};

	app.get('/stats', function (req, res) {
		res.send({
			"clients"    : Object.keys(_this.poolObj.stratumServer.getStratumClients()).length,
			"counters"   : counters,
			"lastEvents" : lastEvents
		});
	});


	this.start = function (poolObj) {
		this.poolObj = poolObj;
		this.poolObj.once('started', function () {
			app.listen(listen, function (lol) {
				console.log("LISTENING ");
			});
		})
		.on('share', function(isValidShare, isValidBlock, shareData) {
			var now = Date.now();
			if (isValidShare) {
				counters.validShares ++;
				lastEvents.lastValidShare = now;
				if (isValidBlock) {
					counters.validBlocks ++;
					lastEvents.lastValidBlock = now;
				}
			} else {
				counters.invalidShares ++;
				lastEvents.lastInvalidShare = now;
			}
		});
	}
}



module.exports = workerapi;


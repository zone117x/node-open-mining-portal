var workerHashrateData;
var workerHashrateChart;
var workerHistoryMax = 160;

var statData;
var totalHash;
var totalImmature;
var totalBal;
var totalPaid;
var totalShares;

function getReadableHashRateString(hashrate){
	hashrate = (hashrate * 1000000);
	if (hashrate < 1000000) {
		return '0 hash/s';
	}
	var byteUnits = [' Hash/s', ' KHash/s', ' MHash/s', ' GHash/s', ' THash/s', ' PHash/s', ' EHash/s', ' ZHash/s', ' YHash/s' ];
	var i = Math.floor((Math.log(hashrate/1000) / Math.log(1000)) - 1);
	hashrate = (hashrate/1000) / Math.pow(1000, i + 1);
	return hashrate.toFixed(2) + byteUnits[i];
}

function getReadableLuckTime(lucktime){
	var luck = lucktime;
	var timeUnits = [' Days', ' Hours', ' Minutes', ' Seconds'];
	if (luck < 1) {
		luck = luck * 24;
		if (luck < 1) {
			luck = luck * 60;
			if (luck < 1) {
				luck = luck * 60;
				return luck.toFixed(2) + timeUnits[3];
			} else {
				return luck.toFixed(2) + timeUnits[2];
			}
		} else {
			return luck.toFixed(2) + timeUnits[1];
		}
	}
	return luck + timeUnits[0];
}

function timeOfDayFormat(timestamp){
    var dStr = d3.time.format('%I:%M %p')(new Date(timestamp));
    if (dStr.indexOf('0') === 0) dStr = dStr.slice(1);
    return dStr;
}

function getWorkerNameFromAddress(w) {
	var worker = w;
	if (w.split(".").length > 1) {
		worker = w.split(".")[1];
		if (worker == null || worker.length < 1) {
			worker = "noname";
		}
	} else {
		worker = "noname";
	}
	return worker;
}

function buildChartData(){
    var workers = {};
	for (var w in statData.history) {
		var worker = getWorkerNameFromAddress(w);
		var a = workers[worker] = (workers[worker] || {
			hashrate: []
		});
		for (var wh in statData.history[w]) {
			a.hashrate.push([statData.history[w][wh].time * 1000, statData.history[w][wh].hashrate]);
		}
		if (a.hashrate.length > workerHistoryMax) {
			workerHistoryMax = a.hashrate.length;
		}
	}

	var i=0;
    workerHashrateData = [];
    for (var worker in workers){
        workerHashrateData.push({
            key: worker,
			disabled: (i > Math.min((_workerCount-1), 3)),
            values: workers[worker].hashrate
        });
		i++;
    }
}

function updateChartData(){
    var workers = {};
	for (var w in statData.history) {
		var worker = getWorkerNameFromAddress(w);
		// get a reference to lastest workerhistory
		for (var wh in statData.history[w]) { }
		//var wh = statData.history[w][statData.history[w].length - 1];
		var foundWorker = false;
		for (var i = 0; i < workerHashrateData.length; i++) {
			if (workerHashrateData[i].key === worker) {
				foundWorker = true;
				if (workerHashrateData[i].values.length >= workerHistoryMax) {
					workerHashrateData[i].values.shift();
				}
				workerHashrateData[i].values.push([statData.history[w][wh].time * 1000, statData.history[w][wh].hashrate]);
				break;
			}
		}
		if (!foundWorker) {
			var hashrate = [];
			hashrate.push([statData.history[w][wh].time * 1000, statData.history[w][wh].hashrate]);
			workerHashrateData.push({
				key: worker,
				values: hashrate
			});
			rebuildWorkerDisplay();
			return true;
		}
	}
	triggerChartUpdates();
	return false;
}

function calculateAverageHashrate(worker) {
	var count = 0;
	var total = 1;
	var avg = 0;
	for (var i = 0; i < workerHashrateData.length; i++) {
		count = 0;
		for (var ii = 0; ii < workerHashrateData[i].values.length; ii++) {
			if (worker == null || workerHashrateData[i].key === worker) {
				count++;
				avg += parseFloat(workerHashrateData[i].values[ii][1]);
			}
		}
		if (count > total)
			total = count;
	}
	avg = avg / total;
	return avg;
}

function triggerChartUpdates(){
    workerHashrateChart.update();
}

function displayCharts() {
    nv.addGraph(function() {
        workerHashrateChart = nv.models.lineChart()
            .margin({left: 80, right: 30})
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] })
            .useInteractiveGuideline(true);

        workerHashrateChart.xAxis.tickFormat(timeOfDayFormat);

        workerHashrateChart.yAxis.tickFormat(function(d){
            return getReadableHashRateString(d);
        });
        d3.select('#workerHashrate').datum(workerHashrateData).call(workerHashrateChart);
        return workerHashrateChart;
    });
}

function updateStats() {
	totalHash = statData.totalHash;
	totalPaid = statData.paid;
	totalBal = statData.balance;
	totalImmature = statData.immature;
	totalShares = statData.totalShares;
	// do some calculations
	var luckDays = 0;
	for (var w in statData.workers) { luckDays = luckDays + 1 / statData.workers[w].luckDays; }
	luckDays = getReadableLuckTime(1 / luckDays);
	// update miner stats
	$("#statsHashrate").text(getReadableHashRateString(totalHash));
	$("#statsHashrateAvg").text(getReadableHashRateString(calculateAverageHashrate(null)));
	$("#statsLuckDays").text(luckDays);
	$("#statsTotalImmature").text(totalImmature);
	$("#statsTotalBal").text(totalBal);
	$("#statsTotalPaid").text(totalPaid);
	$("#statsTotalShares").text(totalShares.toFixed(2));
}
function updateWorkerStats() {
	// update worker stats
	var i=0;
	for (var w in statData.workers) { i++;
		var htmlSafeWorkerName = w.split('.').join('_').replace(/[^\w\s]/gi, '');
		var saneWorkerName = getWorkerNameFromAddress(w);
		$("#statsHashrate"+htmlSafeWorkerName).text(getReadableHashRateString(statData.workers[w].hashrate));
		$("#statsHashrateAvg"+htmlSafeWorkerName).text(getReadableHashRateString(calculateAverageHashrate(saneWorkerName)));
		$("#statsLuckDays"+htmlSafeWorkerName).text(statData.workers[w].luckDays);
		$("#statsPaid"+htmlSafeWorkerName).text(statData.workers[w].paid);
		$("#statsBalance"+htmlSafeWorkerName).text(statData.workers[w].balance);
		$("#statsShares"+htmlSafeWorkerName).text(Math.round(statData.workers[w].currRoundShares * 100) / 100);
		$("#statsDiff"+htmlSafeWorkerName).text(statData.workers[w].diff);
	}
}
function addWorkerToDisplay(name, htmlSafeName, workerObj) {
	var htmlToAdd = "";
	htmlToAdd = '<div class="boxStats" id="boxStatsLeft" style="float:left; margin: 9px; min-width: 260px;"><div class="boxStatsList">';
	htmlToAdd+='<div class="boxLowerHeader">'+name.replace(/[^\w\s]/gi, '')+'</div><div>';
	htmlToAdd+='<div><i class="fa fa-tachometer"></i> <span id="statsHashrate'+htmlSafeName+'">'+getReadableHashRateString(workerObj.hashrate)+'</span> (Now)</div>';
	htmlToAdd+='<div><i class="fa fa-tachometer"></i> <span id="statsHashrateAvg'+htmlSafeName+'">'+getReadableHashRateString(calculateAverageHashrate(name))+'</span> (Avg)</div>';
	htmlToAdd+='<div><i class="fa fa-shield"></i> <small>Diff:</small> <span id="statsDiff'+htmlSafeName+'">'+workerObj.diff+'</span></div>';
	htmlToAdd+='<div><i class="fa fa-cog"></i> <small>Shares:</small> <span id="statsShares'+htmlSafeName+'">'+(Math.round(workerObj.currRoundShares * 100) / 100)+'</span></div>';
	htmlToAdd += '<div><i class="fa fa-gavel"></i> <small>Luck <span id="statsLuckDays' + htmlSafeName + '">' + getReadableLuckTime(workerObj.luckDays) +'</span></small></div>';
	htmlToAdd+='</div></div></div>';
	$("#boxesWorkers").html($("#boxesWorkers").html()+htmlToAdd);
}

function rebuildWorkerDisplay() {
	$("#boxesWorkers").html("");
	var i=0;
	for (var w in statData.workers) { i++;
		var htmlSafeWorkerName = w.split('.').join('_').replace(/[^\w\s]/gi, '');
		var saneWorkerName = getWorkerNameFromAddress(w);
		addWorkerToDisplay(saneWorkerName, htmlSafeWorkerName, statData.workers[w]);
	}
}

// resize chart on window resize
nv.utils.windowResize(triggerChartUpdates);

$(function() {
	// grab initial stats
	$.getJSON(`/api/worker_stats?coin=${_coin}&address=${_miner}`, function(data){
		statData = data;
		for (var w in statData.workers) { _workerCount++; }
		buildChartData();
		displayCharts();
		rebuildWorkerDisplay();
		updateStats();
	});

	// live stat updates
	statsSource.addEventListener('message', function(e){
		if (document.hidden) return;
		
		// TODO, create miner_live_stats...
		// miner_live_stats will return the same josn except without the worker history
		// FOR NOW, use this to grab updated stats
		$.getJSON(`/api/worker_stats?coin=${_coin}&address=${_miner}`, function(data){
			statData = data;
			// check for missing workers
			var wc = 0;
			var rebuilt = false;
			// update worker stats
			for (var w in statData.workers) { wc++; }
			// TODO, this isn't 100% fool proof!
			if (_workerCount != wc) {
				if (_workerCount > wc) {
					rebuildWorkerDisplay();
					rebuilt = true;
				}
				_workerCount = wc;
			}
			rebuilt = (rebuilt || updateChartData());
			updateStats();
			if (!rebuilt) {
				updateWorkerStats();
			}
		});
	});
})

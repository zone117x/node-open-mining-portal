var poolHashrateData;
var poolHashrateChart;
var poolPendingData;
var poolPendingChart;

var statData;
var poolKeys;

function buildChartData(){

    var pools = {};

    poolKeys = [];
    for (var i = 0; i < statData.length; i++){
        for (var pool in statData[i].pools){
            if (poolKeys.indexOf(pool) === -1)
                poolKeys.push(pool);
        }
    }

    for (var i = 0; i < statData.length; i++) {
        var time = statData[i].time * 1000;
                for (var f = 0; f < poolKeys.length; f++){
            var pName = poolKeys[f];
            var a = pools[pName] = (pools[pName] || {
                hashrate: [], pending: []
            });
            if (pName in statData[i].pools){
                a.hashrate.push([time, statData[i].pools[pName].hashrate]);
                a.pending.push([time, statData[i].pools[pName].blocks.pending]);
            }
            else{
                a.hashrate.push([time, 0]);
            }

        }

    }

    poolHashrateData = [];
    poolPendingData = [];
    for (var pool in pools){
       poolHashrateData.push({
            key: pool,
            values: pools[pool].hashrate
        });
        poolPendingData.push({
             key: pool,
             values: pools[pool].pending
         });
                $('#statsHashrateAvg' + pool).text(getReadableHashRateString(calculateAverageHashrate(pool)));
    }
}

function calculateAverageHashrate(pool) {
                var count = 0;
                var total = 1;
                var avg = 0;
                for (var i = 0; i < poolHashrateData.length; i++) {
                        count = 0;
                        for (var ii = 0; ii < poolHashrateData[i].values.length; ii++) {
                                if (pool == null || poolHashrateData[i].key === pool) {
                                        count++;
                                        avg += parseFloat(poolHashrateData[i].values[ii][1]);
                                }
                        }
                        if (count > total)
                                total = count;
                }
                avg = avg / total;
                return avg;
}

function getReadableHashRateString(hashrate){
        hashrate = (hashrate * 1000000);
        if (hashrate < 1000000) {
                return '0 Hash/s';
                //return (Math.round(hashrate / 1000) / 1000 ).toFixed(2)+' Sol/s';
        }
    var byteUnits = [' Hash/s', ' KHash/s', ' MHash/s', ' GHash/s', ' THash/s', ' PHash/s', ' EHash/s', ' ZHash/s', ' YHash/s'];
    var i = Math.floor((Math.log(hashrate/1000) / Math.log(1000)) - 1);
    hashrate = (hashrate/1000) / Math.pow(1000, i + 1);
    return hashrate.toFixed(2) + byteUnits[i];
 }

 function getReadableLuckTime(lucktime){
     var luck = lucktime;
     var timeUnits = [' Days', ' Hours', ' Minutes', ' Seconds' ];
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

function displayCharts(){
    nv.addGraph(function() {
        poolHashrateChart = nv.models.lineChart()
            .margin({left: 80, right: 30})
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] })
            .useInteractiveGuideline(true);

        poolHashrateChart.xAxis.tickFormat(timeOfDayFormat);

        poolHashrateChart.yAxis.tickFormat(function(d){
            return getReadableHashRateString(d);
        });

        d3.select('#poolHashrate').datum(poolHashrateData).call(poolHashrateChart);

        return poolHashrateChart;
    });

    nv.addGraph(function() {
        poolPendingChart = nv.models.lineChart()
            .margin({left: 80, right: 30})
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] })
            .useInteractiveGuideline(true);
        poolPendingChart.xAxis.tickFormat(timeOfDayFormat);

        poolPendingChart.yAxis.tickFormat(function(d){
            return d.toFixed(2);
        });

        d3.select('#poolPending').datum(poolPendingData).call(poolPendingChart);

        return poolPendingChart;
    });
}

function triggerChartUpdates(){
    poolHashrateChart.update();
    poolPendingChart.update();
}

nv.utils.windowResize(triggerChartUpdates);

function rebuildAllChart() {
    $.getJSON('/api/pool_stats', function(data){
        statData = data;
        buildChartData();
        displayCharts();
    });
}
rebuildAllChart();

var poolChartHidden = false;

statsSource.addEventListener('message', function(e){
    if (document.hidden) {
        poolChartHidden = true;
        return;
    }

    if (poolChartHidden) {
        poolChartHidden = false;
        rebuildAllChart();
        return;
    }

    var stats = JSON.parse(e.data);
    statData.push(stats);
    if (statData.length > 482) statData.shift();

    var newPoolAdded = (function(){
        for (var p in stats.pools){
            if (poolKeys.indexOf(p) === -1)
                return true;
        }
        return false;
    })();

    if (newPoolAdded || Object.keys(stats.pools).length > poolKeys.length){
        buildChartData();
        displayCharts();
    }
    else {
        var time = stats.time * 1000;
        for (var f = 0; f < poolKeys.length; f++) {
            var pool =  poolKeys[f];
            for (var i = 0; i < poolHashrateData.length; i++) {
                if (poolHashrateData[i].key === pool) {
                    poolHashrateData[i].values.shift();
                    poolHashrateData[i].values.push([time, pool in stats.pools ? stats.pools[pool].hashrate : 0]);
                                        $('#statsHashrateAvg' + pool).text(getReadableHashRateString(calculateAverageHashrate(pool)));
                    break;
                }
            }
            for (var i = 0; i < poolPendingData.length; i++) {
                if (poolPendingData[i].key === pool) {
                    poolPendingData[i].values.shift();
                    poolPendingData[i].values.push([time, pool in stats.pools ? stats.pools[pool].blocks.pending : 0]);
                    break;
                }
            }
        }
        triggerChartUpdates();
    }


});
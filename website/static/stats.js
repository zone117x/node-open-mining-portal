var poolWorkerData = [];
var poolHashrateData = [];
var poolBlockData = [];

var poolWorkerChart;
var poolHashrateChart;
var poolBlockChart;

function buildChartData(data){

    var pools = {};

    for (var i = 0; i < data.length; i++){
        var time = data[i].time * 1000;
        for (var pool in data[i].pools){
            var a = pools[pool] = (pools[pool] || {
                hashrate: [],
                workers: [],
                blocks: []
            });
            a.hashrate.push([time, data[i].pools[pool].hashrate || 0]);
            a.workers.push([time, data[i].pools[pool].workers || 0]);
            a.blocks.push([time, data[i].pools[pool].blocks.pending])
        }
    }

    for (var pool in pools){
        poolWorkerData.push({
            key: pool,
            values: pools[pool].workers
        });
        poolHashrateData.push({
            key: pool,
            values: pools[pool].hashrate
        });
        poolBlockData.push({
            key: pool,
            values: pools[pool].blocks
        })
    }
}

function getReadableHashRateString(hashrate){
    var i = -1;
    var byteUnits = [ ' KH', ' MH', ' GH', ' TH', ' PH' ];
    do {
        hashrate = hashrate / 1024;
        i++;
    } while (hashrate > 1024);
    return hashrate.toFixed(2) + byteUnits[i];
}

function displayCharts(){

    nv.addGraph(function() {
        poolWorkerChart = nv.models.stackedAreaChart()
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] })
            .useInteractiveGuideline(true)
            .clipEdge(true);

        poolWorkerChart.xAxis.tickFormat(function(d) {
            return d3.time.format('%X')(new Date(d))
        });

        poolWorkerChart.yAxis.tickFormat(d3.format('d'));

        d3.select('#poolWorkers').datum(poolWorkerData).call(poolWorkerChart);

        return poolWorkerChart;
    });


    nv.addGraph(function() {
        poolHashrateChart = nv.models.lineChart()
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] })
            .useInteractiveGuideline(true);

        poolHashrateChart.xAxis.tickFormat(function(d) {
            return d3.time.format('%X')(new Date(d))
        });

        poolHashrateChart.yAxis.tickFormat(function(d){
            return getReadableHashRateString(d);
        });

        d3.select('#poolHashrate').datum(poolHashrateData).call(poolHashrateChart);

        return poolHashrateChart;
    });


    nv.addGraph(function() {
        poolBlockChart = nv.models.multiBarChart()
            .x(function(d){ return d[0] })
            .y(function(d){ return d[1] });

        poolBlockChart.xAxis.tickFormat(function(d) {
            return d3.time.format('%X')(new Date(d))
        });

        d3.select('#poolBlocks').datum(poolBlockData).call(poolBlockChart);

        return poolBlockChart;
    });
}

function TriggerChartUpdates(){
    poolWorkerChart.update();
    poolHashrateChart.update();
    poolBlockChart.update();
}

nv.utils.windowResize(TriggerChartUpdates);

$.getJSON('/api/pool_stats', function(data){
    buildChartData(data);
    displayCharts();
});

statsSource.addEventListener('message', function(e){
    var stats = JSON.parse(e.data);
    var time = stats.time * 1000;
    for (var pool in stats.pools){
        for (var i = 0; i < poolWorkerData.length; i++){
            if (poolWorkerData[i].key === pool){
                poolWorkerData[i].values.shift();
                poolWorkerData[i].values.push([time, stats.pools[pool].workerCount]);
                break;
            }
        }
        for (var i = 0; i < poolHashrateData.length; i++){
            if (poolHashrateData[i].key === pool){
                poolHashrateData[i].values.shift();
                poolHashrateData[i].values.push([time, stats.pools[pool].hashrate]);
                break;
            }
        }
        for (var i = 0; i < poolBlockData.length; i++){
            if (poolBlockData[i].key === pool){
                poolBlockData[i].values.shift();
                poolBlockData[i].values.push([time, stats.pools[pool].blocks.pending]);
                break;
            }
        }
    }

    TriggerChartUpdates();
});
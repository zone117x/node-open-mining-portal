var poolWorkerData;
var poolHashrateData;
var poolBlockPendingData;

var poolWorkerChart;
var poolHashrateChart;
var poolBlockPendingChart;

var statData = [];
var poolKeys = [];

var timeHolder;
var columnBuffer = 0;
var poolColors;

function trimData(data, interval) {
    var retentionTime = Date.now() / 1000 - interval | 0;
    if(data.length > 60){
        for (var i = data.length - 1; i >= 0; i--){
            if (retentionTime > data[i].time){
                statData = data.slice(i);
                break;
            }
        }
    } else {
        statData = data;
    }

}

function buildChartData(){
    var pools = {};

    poolKeys = [];
    for (var i = 0; i < statData.length; i++){
        for (var pool in statData[i].pools){
            if (poolKeys.indexOf(pool) === -1)
                poolKeys.push(pool);
        }
    }

    for (var i = 0; i < statData.length; i++){

        var time = statData[i].time * 1000;

        for (var f = 0; f < poolKeys.length; f++){

            var pName = poolKeys[f];

            var a = pools[pName] = (pools[pName] || {
                hashrate: [],
                workers: [],
                blocksPending: []
            });

            if (pName in statData[i].pools){
                a.hashrate.push([time, statData[i].pools[pName].hashrate]);
                a.workers.push([time, statData[i].pools[pName].workerCount]);
                a.blocksPending.push([time, statData[i].pools[pName].blocks.pending]);
            }
            else{
                a.hashrate.push([time, 0]);
                a.workers.push([time, 0]);
                a.blocksPending.push([time, 0]);
            }

        }

    }

    poolWorkerData = [];
    poolHashrateData = [];
    poolBlockPendingData = [];

    for (var pool in pools){
        poolWorkerData.push({
            key: pool,
            values: pools[pool].workers
        });
        poolHashrateData.push({
            key: pool,
            values: pools[pool].hashrate
        });
        poolBlockPendingData.push({
            key: pool,
            values: pools[pool].blocksPending
        });
    }
}

function removeAllSeries() {
    while(poolWorkerChart.series.length > 0)
        poolWorkerChart.series[0].remove();
    while(poolHashrateChart.series.length > 0)
        poolHashrateChart.series[0].remove();
    while(poolBlockPendingChart.series.length > 0)
        poolBlockPendingChart.series[0].remove();
}

function changeGraphTimePeriod(timePeriod, sender) {
    timeHolder = new Date().getTime();
    removeAllSeries();
    $.getJSON('/api/pool_stats', function (data) {
        trimData(data, timePeriod);
        buildChartData();
        displayCharts();
        console.log("time to changeTimePeriod: " + (new Date().getTime() - timeHolder));
    });

    $('#scale_menu li a').removeClass('pure-button-active');
    $('#' + sender).addClass('pure-button-active');
}

function setHighchartsOptions() {
    Highcharts.setOptions({
        global : {
            useUTC : false
        }
    });
    var graphColors = $('#bottomCharts').data('info');
    if(graphColors !== 'undefined') {
        Highcharts.theme = {
            colors: graphColors.split(",")
        };
        Highcharts.setOptions(Highcharts.theme);
    }
}

function createCharts() {
    setHighchartsOptions();
    poolWorkerChart = new Highcharts.Chart({
        chart: {
            renderTo: 'poolWorkerChart',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            animation: false,
            shadow: false,
            borderWidth: 0
        },
        credits: {
            enabled: false
        },
        exporting: {
            enabled: false
        },
        title: {
            text: 'Workers Per Pool'
        },
        xAxis: {
            type: 'datetime',
            dateTimeLabelFormats: {
                second: '%I:%M:%S %p',
                minute: '%I:%M %p',
                hour: '%I:%M %p',
                day: '%I:%M %p'
            },
            title: {
                text: null
            }
        },
        yAxis: {
            labels: {

            },
            title: {
                text: null
            },
            min: 0
        },
        tooltip: {
            useHTML: false,
            shared: true,
            crosshairs: true,
            useHTML: true,
            formatter: function () {
                var s = '<b>' + timeOfDayFormat(this.x) + '</b>';

                $.each(this.points, function (i, point) {
                    s += '<br/> <span style="color:' + point.series.color + '" x="8" dy="16">&#9679;</span> ' + point.series.name + ': ' + point.y;
                });
                return s;
            }
        },
        legend: {
            enabled: true,
            borderWidth: 0
        },
        plotOptions: {
            area: {
                stacking: 'normal',
                lineWidth: 1,
                marker: {
                    enabled: false
                }
            }
        },
        series: []
    });
    poolHashrateChart = new Highcharts.Chart({
        chart: {
            renderTo: 'poolHashRateChart',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            animation: true,
            shadow: false,
            borderWidth: 0,
            zoomType: 'x'
        },
        credits: {
            enabled: false
        },
        exporting: {
            enabled: false
        },
        title: {
            text: 'Hashrate Per Pool'
        },
        xAxis: {
            type: 'datetime',
            dateTimeLabelFormats: {
                second: '%I:%M:%S %p',
                minute: '%I:%M %p',
                hour: '%I:%M %p',
                day: '%I:%M %p'
            },
            title: {
                text: null
            },
            minRange: 36000
        },
        yAxis: {
            labels: {
                formatter: function () {
                    return getReadableHashRateString(this.value, 'beta');
                }
            },
            title: {
                text: null
            },
            min: 0
        },
        tooltip: {
            shared: true,
            valueSuffix: ' H/s',
            crosshairs: true,
            useHTML: true,
            formatter: function () {
                var s = '<b>' + timeOfDayFormat(this.x) + '</b>';

                var hashrate = 0;
                $.each(this.points, function (i, point) {
                    val = getReadableHashRateString(point.y, 'tooltip');
                    s += '<br/> <span style="color:' + point.series.color + '" x="8" dy="16">&#9679;</span> ' + point.series.name + ': ' + val;
                });
                return s;
            }
        },
        legend: {
            enabled: true,
            borderWidth: 0
        },
        plotOptions: {
            spline: {
                marker: {
                    enabled: false
                },
                lineWidth: 1.75,
                shadow: false,
                states: {
                    hover: {
                        lineWidth: 1.75
                    }
                },
                threshold: null,
                animation: true
            }
        },
        series: []
    });
    poolBlockPendingChart = new Highcharts.Chart({
        chart: {
            renderTo: 'poolBlockChart',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            animation: true,
            shadow: false,
            borderWidth: 0
        },
        credits: {
            enabled: false
        },
        exporting: {
            enabled: false
        },
        title: {
            text: 'Blocks Pending Per Pool'
        },
        xAxis: {
            type: 'datetime',
            dateTimeLabelFormats: {
                second: '%I:%M:%S %p',
                minute: '%I:%M %p',
                hour: '%I:%M %p',
                day: '%I:%M %p'
            },
            title: {
                text: null
            }
        },
        yAxis: {
            labels: {

            },
            title: {
                text: null
            },
            min: 0
        },
        tooltip: {
            shared: true,
            crosshairs: false,
            useHTML: true,
            formatter: function () {
                var s = '<b>' + timeOfDayFormat(this.x) + '</b>';

                $.each(this.points, function (i, point) {
                    s += '<br/> <span style="color:' + point.series.color + '" x="8" dy="16">&#9679;</span> ' + point.series.name + ': ' + point.y;
                });
                return s;
            }
        },
        legend: {
            enabled: true,
            borderWidth: 0
        },
        plotOptions: {
            column: {
                stacking: 'normal',
                pointWidth: 15,
                pointRange: 0,
                pointPadding: 0,
                borderWidth: 0
            }
        },
        series: []
    });
}

function displayCharts(){
    for (var i = 0; i < poolKeys.length; i++) {
        if(poolWorkerChart.series.length < poolKeys.length) {
            poolWorkerChart.addSeries({
                type: 'area',
                name: capitaliseFirstLetter(poolWorkerData[i].key),
                data: poolWorkerData[i].values,
                lineWidth: 2
            }, false);
        }
        if(poolHashrateChart.series.length < poolKeys.length) {
            poolHashrateChart.addSeries({
                type: 'spline',
                name: capitaliseFirstLetter(poolHashrateData[i].key),
                data: poolHashrateData[i].values,
                lineWidth: 2
            }, false);
        }
        if(poolBlockPendingChart.series.length < poolKeys.length) {
            poolBlockPendingChart.addSeries({
                type: 'column',
                name: capitaliseFirstLetter(poolBlockPendingData[i].key),
                data: poolBlockPendingData[i].values,
                pointWidth: ((poolBlockPendingChart.chartWidth / statData.length) - columnBuffer)
            }, false);
        }

        if (typeof poolColors !== "undefined") {
            var pName = poolKeys[i].toLowerCase();
            poolWorkerChart.series[i].update({color: poolColors[pName].color}, false);
            poolHashrateChart.series[i].update({color: poolColors[pName].color}, false);
            poolBlockPendingChart.series[i].update({color: poolColors[pName].color}, false);
        }
    }
    poolWorkerChart.redraw();
    poolHashrateChart.redraw();
    poolBlockPendingChart.redraw();
}

function savePoolColors() {
    poolColors = {};
    if(poolWorkerChart.series[0]) {
        $.each(poolWorkerChart.series.reverse(), function(i) {
            var b = poolColors[poolWorkerChart.series[i].name.toLowerCase()] = ({
                color: ''
            });
            b.color = poolWorkerChart.series[i].color;
        });
    }
}

function getInternetExplorerVersion(){
    var rv = -1; // Return value assumes failure.
    if (navigator.appName == 'Microsoft Internet Explorer')
    {
        var ua = navigator.userAgent;
        var re  = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
        if (re.exec(ua) != null)
            rv = parseFloat( RegExp.$1 );
    }
    return rv;
}

function getReadableHashRateString(hashrate, version){
    if(version == 'default') {
        var i = -1;
        var byteUnits = [ ' KH', ' MH', ' GH', ' TH', ' PH' ];
        do {
            hashrate = hashrate / 1024;
            i++;
        } while (hashrate > 1024);
        return Math.round(hashrate) + byteUnits[i];
    } else if(version == 'beta') {
        if (hashrate > Math.pow(1000, 4)) {
            return (hashrate / Math.pow(1000, 4)) + ' TH/s';
        }
        if (hashrate > Math.pow(1000, 3)) {
            return (hashrate / Math.pow(1000, 3)) + ' GH/s';
        }
        if (hashrate > Math.pow(1000, 2)) {
            return (hashrate / Math.pow(1000, 2)) + ' MH/s';
        }
        if (hashrate > Math.pow(1000, 1)) {
            return (hashrate / Math.pow(1000, 1)) + ' KH/s';
        }
        return hashrate + ' H/s';
    } else if(version == 'tooltip') {
        if (hashrate > Math.pow(1000, 4)) {
            return (hashrate / Math.pow(1000, 4)).toFixed(2) + ' TH/s';
        } else if (hashrate > Math.pow(1000, 3)) {
            return (hashrate / Math.pow(1000, 3)).toFixed(2) + ' GH/s';
        } else if (hashrate > Math.pow(1000, 2)) {
            return (hashrate / Math.pow(1000, 2)).toFixed(2) + ' MH/s';
        } else if (hashrate > Math.pow(1000, 1)) {
            return (hashrate / Math.pow(1000, 1)).toFixed(2) + ' KH/s';
        } else {
            return hashrate + ' H/s';
        }
    }
}

function capitaliseFirstLetter(string){
    return string.charAt(0).toUpperCase() + string.substring(1);
}

function timeOfDayFormat(timestamp){
    var tempTime = moment(timestamp).format('MMM Do - h:mm A');
    if (tempTime.indexOf('0') === 0) tempTime = tempTime.slice(1);
    return tempTime;
}

(function ($){
    timeHolder = new Date().getTime();
    var ver = getInternetExplorerVersion();
    if (ver !== -1 && ver<=10.0) {
        $(window).load(function(){
            createCharts();
            $.getJSON('/api/pool_stats', function (data) {
                trimData(data, 3600);
                buildChartData();
                displayCharts();
                savePoolColors();
                console.log("time to load: " + (new Date().getTime() - timeHolder));
            });
        });
    } else {
        $(function() {
            createCharts();
            $.getJSON('/api/pool_stats', function (data) {
                trimData(data, 3600);
                buildChartData();
                displayCharts();
                savePoolColors();
                console.log("time to load: " + (new Date().getTime() - timeHolder));
            });
        });
    }
}(jQuery));

statsSource.addEventListener('message', function(e){ //Stays active when hot-swapping pages
    var stats = JSON.parse(e.data);
    statData.push(stats);
    var newPoolAdded = (function(){
        for (var p in stats.pools){
            if (poolKeys.indexOf(p) === -1)
                return true;
        }
        return false;
    })();

    if (newPoolAdded || Object.keys(stats.pools).length > poolKeys.length){
        buildChartData();
    }
    else {
        timeHolder = new Date().getTime(); //Temporary
        var time = stats.time * 1000;

        for (var f = 0; f < poolKeys.length; f++) {
            var pool =  poolKeys[f];
            for (var i = 0; i < poolWorkerData.length; i++) {
                if (poolWorkerData[i].key === pool) {
                    poolWorkerData[i].values.shift();
                    poolWorkerData[i].values.push([time, pool in stats.pools ? stats.pools[pool].workerCount : 0]);
                    if(poolWorkerChart.series[f].name.toLowerCase() === pool) {
                        poolWorkerChart.series[f].addPoint([time, pool in stats.pools ? stats.pools[pool].workerCount : 0], true);
                    }
                    break;
                }
            }
            for (var i = 0; i < poolHashrateData.length; i++) {
                if (poolHashrateData[i].key === pool) {
                    poolHashrateData[i].values.shift();
                    poolHashrateData[i].values.push([time, pool in stats.pools ? stats.pools[pool].hashrate : 0]);
                    if(poolHashrateChart.series[f].name.toLowerCase() === pool) {
                        poolHashrateChart.series[f].setData(poolHashrateData[i].values, true);
                    }
                    break;
                }
            }
            for (var i = 0; i < poolBlockPendingData.length; i++) {
                if (poolBlockPendingData[i].key === pool) {
                    poolBlockPendingData[i].values.shift();
                    poolBlockPendingData[i].values.push([time, pool in stats.pools ? stats.pools[pool].blocks.pending : 0]);
                    if(poolBlockPendingChart.series[f].name.toLowerCase() === pool) {
                        poolBlockPendingChart.series[f].setData(poolBlockPendingData[i].values, false);
                        poolBlockPendingChart.series[f].update({pointWidth: ((poolBlockPendingChart.chartWidth / poolBlockPendingChart.series[f].data.length) - columnBuffer)}, true);
                    }
                    break;
                }
            }
        }
    }
    for (var pool in stats.pools) {
        $('#statsValidShares' + pool).text(stats.pools[pool].poolStats.validShares);
        $('#statsInvalidShares' + pool).text(stats.pools[pool].poolStats.invalidShares);
        $('#statsValidBlocks' + pool).text(stats.pools[pool].poolStats.validBlocks);
        $('#statsBlocksPending' + pool).text(stats.pools[pool].blocks.pending);
        $('#statsBlocksConfirmed' + pool).text(stats.pools[pool].blocks.confirmed);
        $('#statsBlocksOrphaned' + pool).text(stats.pools[pool].blocks.orphaned);
    }
    console.log("time to update stats: " + (new Date().getTime() - timeHolder));
});

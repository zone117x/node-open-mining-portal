const http = require('http');
const fsPromise = require('fs/promises');

var dot = require('dot');
var express = require('express');
var bodyParser = require('body-parser');
var compress = require('compression');
const redis = require('redis');
const { Server: WebSocketServer } = require('ws');

module.exports = function(logger){
    dot.templateSettings.strip = false;

    const portalConfig = JSON.parse(process.env.portalConfig);
    const poolConfigs = JSON.parse(process.env.pools);
    const forkId = process.env.forkId;

    const redisClient = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);

    const logSystem = 'Website';
    const logSubCat = `Thread ${parseInt(forkId) + 1}`;

    const pageFiles = {
        'index.html': 'index',
        'home.html': '',
        'getting_started.html': 'getting_started',
        'stats.html': 'stats',
        'tbs.html': 'tbs',
        'workers.html': 'workers',
        'api.html': 'api',
        'miner_stats.html': 'miner_stats',
        'payments.html': 'payments'
    };

    const pageIds = Object.keys(pageFiles).reduce((acc, cur) => {
        acc[pageFiles[cur]] = cur;
        return acc;
    }, {});

    const liveStatConnections = {};

    process.on('message', (msg) => {
        switch(msg.type) {
        case 'stats':
            Object.keys(liveStatConnections).forEach(uid => {
                const ws = liveStatConnections[uid];
                ws.send(msg.stats);
            });
            break;
        }
    });

    function getStats() {
        return new Promise((resolve) => {
            redisClient.get('statCurrent', (error, result) => {
                if (error) {
                    reject(error);
                } else if (!result) {
                    resolve({});
                } else {
                    resolve(JSON.parse(result));
                }
            });
        });
    }

    function getHistory() {
        return new Promise((resolve, reject) => {
            const retentionTime = (((Date.now() / 1000) - portalConfig.website.stats.historicalRetention) | 0).toString();

            redisClient.zrangebyscore(['statHistory', retentionTime, '+inf'], (err, replies) => {
                if (err) {
                    reject(err);
                } else {
                    resolve((replies || []).map(r => JSON.parse(r)).sort((a, b) => a.time - b.time));
                }
            });
        });
    }

    async function ApiStats(res) {
        try {
            const stats = await getStats();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (error) {
            logger.error(logSystem, 'Stats', logSubCat, 'Error when trying to grab stats');
            console.log(error);
            res.status(500).send(error.stack || error.message);
        }
    }

    async function ApiHistory(res) {
        try {
            const history = await getHistory();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(history));
        } catch (error) {
            logger.error(logSystem, 'Historics', logSubCat, 'Error when trying to grab historical stats');
            console.log(error);
            res.status(500).send(error.stack || error.message);
        }
    }

    async function ApiMiniHistory(res) {
        try {
            const history = await getHistory();

            const miniHistory = history.map(({time, pools}) => {
                pools = Object.keys(pools).reduce((acc, coin) => {
                    const pool = pools[coin];

                    acc[coin] = {
                        hashrate: pool.hashrate,
                        workerCount: pool.workerCount,
                        blocks: pool.blocks,
                    }

                    return acc;
                }, {});

                return {
                    time,
                    pools
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(miniHistory));
        } catch (error) {
            logger.error(logSystem, 'Historics', logSubCat, 'Error when trying to grab historical stats');
            console.log(error);
            res.status(500).send(error.stack || error.message);
        }
    }

    async function ApiBlocks(res) {
        try {
            const stats = await getStats();

            const blocks = Object.keys(stats.pools)
                .map(coin => [
                    ...stats.pools[coin].pendingBlocks,
                    ...stats.pools[coin].confirmedBlocks
                ])
                .flat();

            const allBlocks = blocks.reduce((acc, block) => {
                acc[`${block.coin}-${block.height}`] = block.serialized;
                return acc;
            }, {});

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(allBlocks));
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    async function ApiPayments(res) {
        try {
            const stats = await getStats();

            const payments = Object.keys(stats.pools).map((coin) => {
                const coinStats = stats.pools[coin];

                return {
                    name: coinStats.name,
                    payments: coinStats.payments
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payments));
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    async function ApiWorkers(req, res) {
        try {
            // todo: address validation function here
            const { coin, address } = req.query;

            const [stats, historicStats] = await Promise.all([
                getStats(),
                getHistory()
            ]);

            const coinStats = stats.pools[coin] || {};
            const minerStats = coinStats?.miners?.[address] || {};

            const workers = coinStats.workers
                ? Object.keys(coinStats.workers)
                    .filter(workerId => workerId.split('.')[0] === address)
                    .reduce((acc, workerId) => {
                        acc[workerId] = coinStats.workers[workerId];
                        return acc;
                    }, {})
                : {};

            const history = historicStats
                .map(portalStats => Object.values(portalStats.pools[coin]?.workers || {}))
                .flat()
                .filter(w => w.address === address)
                .reduce((acc, worker) => {
                    if (!acc[worker.name]) {
                        acc[worker.name] = [];
                    }

                    acc[worker.name].push({
                        time: worker.time,
                        hashrate: worker.hashrate,
                    });

                    return acc;
                }, {});

            const payments = (coinStats.payments || []).filter(payment => {
                return Object.keys(payment.amounts).includes(address);
            });

            const miner = {
                miner: address,
                totalHash: minerStats.hashrate || 0,
                totalShares: minerStats.shares || 0,
                networkSols: coinStats.hashrate || 0,
                immature: minerStats.immature || 0,
                balance: minerStats.balance || 0,
                paid: minerStats.paid || 0,
                workers,
                history,
                payments
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(miner));
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    function handleApiRequest(req, res, next) {
        switch(req.params.method){
        case 'stats':
            ApiStats(res);
            return;
        case 'all_stats':
            ApiHistory(res);
            return;
        case 'pool_stats':
            ApiMiniHistory(res);
            return;
        case 'blocks':
            ApiBlocks(res);
            return;
        case 'payments':
            ApiPayments(res);
            return;
        case 'worker_stats':
            ApiWorkers(req, res);
            return;
        case 'live_stats':
            res.status(404).send('Endpoint deprecated, use websocket connection with /api/ws_stats');
            return;
        default:
            next();
        }
    }

    async function renderTemplate(pageId) {
        const fileName = pageIds[pageId];
        const filePath = `website/${fileName === 'index.html' ? '' : 'pages/'}${fileName}`;
        const fileData = await fsPromise.readFile(filePath, { encoding: 'utf8' });
        return dot.template(fileData);
    }

    async function renderPage(pageId, additional = {}) {
        const [indexTemplate, template, stats] = await Promise.all([
            renderTemplate('index'),
            renderTemplate(pageId),
            getStats()
        ]);
        const page = template({
            poolsConfigs: poolConfigs,
            stats,
            portalConfig,
            ...additional,
        });
        return indexTemplate({
            page,
            selected: pageId,
            stats,
            poolConfigs: poolConfigs,
            portalConfig,
        });
    }

    async function getPage(pageId, res, next) {
        if (!pageIds[pageId]) {
            next();
            return;
        }

        try {
            const [template, stats] = await Promise.all([
                renderTemplate(pageId),
                getStats()
            ]);

            res.end(template({
                poolsConfigs: poolConfigs,
                stats,
                portalConfig,
            }));
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    async function routeMiners(req, res, next) {
        const { address, coin } = req.params;

        // todo: address validation function here
        if (!address || !coin) {
            next();
            return;
        }

        try {
            const page = await renderPage('miner_stats', {
                address,
                coin,
            });

            res.header('Content-Type', 'text/html');
            res.end(page);
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    async function route(pageId, res, next) {
        if (!pageIds[pageId] || pageId === 'index') {
            next();
            return;
        }

        try {
            const page = await renderPage(pageId);

            res.header('Content-Type', 'text/html');
            res.end(page);
        } catch (error) {
            res.status(500).send(error.stack || error.message);
        }
    }

    const app = express();

    app.use(bodyParser.json());

    app.get('/api/:method', (req, res, next) => {
        handleApiRequest(req, res, next);
    });

    app.get('/get_page', (req, res, next) => {
        getPage(req.query.id, res, next);
    });

    app.get('/workers/:coin/:address', (req, res, next) => {
        routeMiners(req, res, next);
    });

    app.get('/:page', (req, res, next) => {
        route(req.params.page || '', res, next);
    });

    app.get('/', (req, res, next) => {
        route(req.params.page || '', res, next);
    });

    app.use(compress());

    app.use('/static', express.static('website/static'));

    app.use(function(err, req, res, next){
        console.error(err.stack);
        res.status(500).send('Something broke!');
    });

    // Wrap again with http.server to share port with WebSocket
    app.server = http.createServer(app);

    const wss = new WebSocketServer({
        server: app.server,
        path: '/api/ws_stats',
        // 10KB
        maxPayload: 10000
    });

    wss.on('connection', (ws) => {
        const uid = Math.random().toString();
        ws.on('close', () => {
            delete liveStatConnections[uid];
        });
        liveStatConnections[uid] = ws;
    });

    wss.on('listening', () => {
        logger.debug(logSystem, 'Server', logSubCat, 'Websokcet server listening...');
    });

    try {
        app.server.listen(portalConfig.website.port, portalConfig.website.host, function () {
            logger.debug(logSystem, 'Server', logSubCat, 'Website started on ' + portalConfig.website.host + ':' + portalConfig.website.port);
        });
    } catch (e) {
        logger.error(logSystem, 'Server', logSubCat, 'Could not start website on ' + portalConfig.website.host + ':' + portalConfig.website.port
            +  ' - its either in use or you do not have permission');
    }
};

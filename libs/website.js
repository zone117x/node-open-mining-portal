/* TODO


Need to condense the entire website into a single html page. Embedding the javascript and css is easy. For images,
hopefully we can only use svg which can be embedded - otherwise we can convert the image into a data-url that can
be embedded, Favicon can also be a data-url which some javascript kungfu can display in browser. I'm focusing on
this mainly to help mitigate ddos and other kinds of attacks - and to just have a badass blazing fast project.

Don't worry about doing any of that condensing yourself - go head and keep all the resources as separate files.
I will write a script for when the server starts to read all the files in the /website folder and minify and condense
it all together into one file, saved in memory. We will have 1 persistent condensed file that servers as our "template"
file that contains things like:
<div>Hashrate: {{=stats.hashrate}</div>

And then on some caching interval (maybe 5 seconds?) we will apply the template engine to generate the real html page
that we serve and hold in in memory - this is the file we serve to seo-bots (googlebot) and users when they first load
the page.

Once the user loads the page we will have server-side event source connected to the portal api where it receives
updated stats on some interval (probably 5 seconds like template cache updater) and applies the changes to the already
displayed page.

We will use fs.watch to detect changes to anything in the /website folder and update our stuff in memory.

 */

var fs = require('fs');
var path = require('path');

var async = require('async');
var dot = require('dot');
var express = require('express');

var api = require('./api.js');


module.exports = function(logger){

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var websiteConfig = portalConfig.website;

    var portalApi = new api(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;

    var logSystem = 'Website';


    var pageFiles = {
        'index.html': 'index',
        'home.html': '',
        'getting_started.html': 'getting_started',
        'stats.html': 'stats',
        'api.html': 'api'
    };

    var pageTemplates = {};

    var pageProcessed = {};
    var indexesProcessed = {};


    var processTemplates = function(){

        for (var pageName in pageTemplates){
            if (pageName === 'index') continue;
            pageProcessed[pageName] = pageTemplates[pageName]({
                poolsConfigs: poolConfigs,
                stats: portalStats.stats,
                portalConfig: portalConfig
            });
            indexesProcessed[pageName] = pageTemplates.index({
                page: pageProcessed[pageName],
                selected: pageName,
                stats: portalStats.stats,
                poolConfigs: poolConfigs,
                portalConfig: portalConfig
            });
        }
        logger.debug(logSystem, 'Stats', 'Website updated to latest stats');
    };


    var readPageFiles = function(){
        async.each(Object.keys(pageFiles), function(fileName, callback){
            var filePath = 'website/' + (fileName === 'index.html' ? '' : 'pages/') + fileName;
            fs.readFile(filePath, 'utf8', function(err, data){
                var pTemp = dot.template(data);
                pageTemplates[pageFiles[fileName]] = pTemp
                callback();
            });
        }, function(err){
            if (err){
                console.log('error reading files for creating dot templates: '+ JSON.stringify(err));
                return;
            }
            processTemplates();
        });
    };



    fs.watch('website', function(event, filename){
        if (event === 'change' && filename in pageFiles)
            readPageFiles();

    });

    portalStats.getGlobalStats(function(){
        readPageFiles(Object.keys(pageFiles));
    });

    var buildUpdatedWebsite = function(){
        portalStats.getGlobalStats(function(){
            processTemplates();

            var statData = 'data: ' + JSON.stringify(portalStats.stats) + '\n\n';
            for (var uid in portalApi.liveStatConnections){
                var res = portalApi.liveStatConnections[uid];
                res.write(statData);
            }

        });
    };

    setInterval(buildUpdatedWebsite, websiteConfig.statUpdateInterval * 1000);


    var app = express();

    var getPage = function(pageId){
        if (pageId in pageProcessed){
            var requestedPage = pageProcessed[pageId];
            return requestedPage;
        }
    };

    var route = function(req, res, next){
        var pageId = req.params.page || '';
        if (pageId in indexesProcessed){
            res.end(indexesProcessed[pageId]);
        }
        else
            next();

    };



    app.get('/get_page', function(req, res, next){
        var requestedPage = getPage(req.query.id);
        if (requestedPage){
            res.end(requestedPage);
            return;
        }
        next();
    });

    app.get('/:page', route);
    app.get('/', route);

    app.get('/api/:method', function(req, res, next){
        portalApi.handleApiRequest(req, res, next);
    });

    app.use('/static', express.static('website/static'));

    app.use(function(err, req, res, next){
        console.error(err.stack);
        res.end(500, 'Something broke!');
    });

    app.listen(portalConfig.website.port, function(){
        logger.debug(logSystem, 'Server', 'Website started on port ' + portalConfig.website.port);
    });


};
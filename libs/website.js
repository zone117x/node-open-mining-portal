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


    var portalApi = new api(logger, poolConfigs);

    var logIdentify = 'Website';

    var websiteLogger = {
        debug: function(key, text){
            logger.logDebug(logIdentify, key, text);
        },
        warning: function(key, text){
            logger.logWarning(logIdentify, key, text);
        },
        error: function(key, text){
            logger.logError(logIdentify, key, text);
        }
    };

    var pageResources = '';
    var pageTemplate;
    var pageProcessed = '';

    var loadWebPage = function(callback){
        fs.readdir('website', function(err, files){
            async.map(files, function(fileName, callback){
                var filePath = 'website/' + fileName;
                fs.readFile(filePath, 'utf8', function(err, data){
                    callback(null, {name: fileName, data: data, ext: path.extname(filePath)});
                });
            }, function(err, fileObjects){

                var indexPage = fileObjects.filter(function(f){
                    return f.name === 'index.html';
                })[0].data;

                var jsCode = '<script>';
                var cssCode = '<style>';
                fileObjects.forEach(function(f){
                    switch(f.ext){
                        case '.css':
                            cssCode += (f.data + '\n\n\n\n');
                            break;
                        case '.js':
                            jsCode += (f.data + ';\n\n\n\n');
                            break;
                    }
                });
                jsCode += '</script>';
                cssCode += '</style>';

                var bodyIndex = indexPage.indexOf('<body>');
                pageTemplate = dot.template(indexPage.slice(bodyIndex));


                pageResources = indexPage.slice(0, bodyIndex);
                var headIndex = pageResources.indexOf('</head>');
                pageResources = pageResources.slice(0, headIndex) +
                    jsCode + '\n\n\n\n' +
                    cssCode + '\n\n\n\n' +
                    pageResources.slice(headIndex);

                applyTemplateInfo();
                callback || function(){}();
            })
        });
    };

    loadWebPage();

    var applyTemplateInfo = function(){

        portalApi.getStats(function(stats){

            //need to give template info about pools and stats

            pageProcessed = pageTemplate({test: 'visitor', time: Date.now()});
        });
    };

    setInterval(function(){
        applyTemplateInfo();
    }, 5000);


    var reloadTimeout;
    fs.watch('website', function(){
        clearTimeout(reloadTimeout);
        reloadTimeout = setTimeout(function(){
            loadWebPage();
        }, 500);
    });


    var app = express();

    //need to create a stats api endpoint for eventsource live stat updates which are triggered on the applytemplateinfo interval




    app.get('/', function(req, res){
        res.send(pageResources + pageProcessed);
    });

    app.use(function(err, req, res, next){
        console.error(err.stack);
        res.send(500, 'Something broke!');
    });

    app.listen(portalConfig.website.port, function(){
        websiteLogger.debug('system', 'Website started on port ' + portalConfig.website.port);
    });


};
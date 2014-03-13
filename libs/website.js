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


var dot = require('dot');
var express = require('express');



module.exports = function(logger){

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

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

    var app = express();

    app.get('/', function(req, res){
        res.send('hello');
    });

    app.use(function(err, req, res, next){
        console.error(err.stack);
        res.send(500, 'Something broke!');
    });

    app.listen(portalConfig.website.port, function(){
        websiteLogger.debug('system', 'Website started on port ' + portalConfig.website.port);
    });


};
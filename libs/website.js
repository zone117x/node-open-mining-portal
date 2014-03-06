/* TODO

listen on port 80 for requests, maybe use express.
read website folder files into memory, and use fs.watch to reload changes to any files into memory

on some interval, apply a templating process to it with the latest api stats. on http requests, serve
this templated file and the other resources in memory.

ideally, all css/js should be included in the html file (try to avoid images, uses embeddable svg)
this would give us one file to have to serve

 */
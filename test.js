var net = require('net');

var socketServer = net.createServer({allowHalfOpen: true}, function(socket){
    console.log(socket);
});
socketServer.listen(1111, function(){
    console.log('started 0');
});
socketServer.listen(1112, function(){
    console.log('started 1');
})
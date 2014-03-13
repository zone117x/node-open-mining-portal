var express = require('express');
var os = require('os');
var app = express();

app.get('/getstatus', function (req, res) {
	res.send({
		'loadavg': os.loadavg(),
		'freemem': os.freemem()
	});
});


module.exports = {
	start: function () {
		app.listen(9000);
	}
}


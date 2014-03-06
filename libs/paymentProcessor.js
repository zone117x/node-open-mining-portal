/**
 * Created by Matt on 3/5/14.
 */
var daemon = new Stratum.daemon.interface([internalConfig.daemon]);
daemon.once('online', function(){
    logger.debug('system', 'Connected to daemon for payment processing');
}).once('connectionFailed', function(error){
        logger.error('system', 'Failed to connect to daemon for payment processing: ' + JSON.stringify(error));
    }).on('error', function(error){
        logger.error('system', error);
    }).init();
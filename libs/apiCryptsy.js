var request = require('request');
var nonce   = require('nonce');
var crypto = require('crypto');

module.exports = function() {
	'use strict';

	// Module dependencies

	// Constants
	var version         = '0.1.0',
	    PUBLIC_API_URL  = 'http://pubapi.cryptsy.com/api.php',
	    PRIVATE_API_URL = 'https://api.cryptsy.com/api',
	    USER_AGENT      = 'nomp/node-open-mining-portal',
	    //Hardcoded for speed however not necessary with updateMarket()
	    MARKETS = { 'BTC/USD': '2',
		    'DOGE/USD': '182',
		    'FTC/USD': '6',
		    'LTC/USD': '1',
		    'ADT/LTC': '94',
		    'ANC/LTC': '121',
		    'ASC/LTC': '111',
		    'AUR/LTC': '161',
		    'BAT/LTC': '186',
		    'BC/LTC': '191',
		    'CGB/LTC': '123',
		    'CNC/LTC': '17',
		    'COL/LTC': '109',
		    'CPR/LTC': '91',
		    'CTM/LTC': '175',
		    'DBL/LTC': '46',
		    'DGC/LTC': '96',
		    'DMC/LTC': '194',
		    'DOGE/LTC': '135',
		    'DVC/LTC': '52',
		    'ELP/LTC': '93',
		    'EZC/LTC': '55',
		    'FLO/LTC': '61',
		    'FRK/LTC': '171',
		    'FST/LTC': '124',
		    'GLD/LTC': '36',
		    'GME/LTC': '84',
		    'IFC/LTC': '60',
		    'JKC/LTC': '35',
		    'KARM/LTC': '193',
		    'MEC/LTC': '100',
		    'MEM/LTC': '56',
		    'MOON/LTC': '145',
		    'MST/LTC': '62',
		    'NET/LTC': '108',
		    'NXT/LTC': '162',
		    'PPC/LTC': '125',
		    'PXC/LTC': '101',
		    'QRK/LTC': '126',
		    'RBBT/LTC': '190',
		    'RED/LTC': '87',
		    'RYC/LTC': '37',
		    'SBC/LTC': '128',
		    'SXC/LTC': '98',
		    'TIPS/LTC': '147',
		    'TIX/LTC': '107',
		    'WDC/LTC': '21',
		    'XNC/LTC': '67',
		    'XPM/LTC': '106',
		    'YAC/LTC': '22',
		    'ZEIT/LTC': '176',
		    'ZET/LTC': '127',
		    '42/BTC': '141',
		    'ALF/BTC': '57',
		    'AMC/BTC': '43',
		    'ANC/BTC': '66',
		    'ARG/BTC': '48',
		    'AUR/BTC': '160',
		    'BC/BTC': '179',
		    'BCX/BTC': '142',
		    'BEN/BTC': '157',
		    'BET/BTC': '129',
		    'BQC/BTC': '10',
		    'BTB/BTC': '23',
		    'BTE/BTC': '49',
		    'BTG/BTC': '50',
		    'BUK/BTC': '102',
		    'CACH/BTC': '154',
		    'CAP/BTC': '53',
		    'CASH/BTC': '150',
		    'CAT/BTC': '136',
		    'CGB/BTC': '70',
		    'CINNI/BTC': '197',
		    'CLR/BTC': '95',
		    'CMC/BTC': '74',
		    'CNC/BTC': '8',
		    'COMM/BTC': '198',
		    'CRC/BTC': '58',
		    'CSC/BTC': '68',
		    'DEM/BTC': '131',
		    'DGB/BTC': '167',
		    'DGC/BTC': '26',
		    'DMD/BTC': '72',
		    'DOGE/BTC': '132',
		    'DRK/BTC': '155',
		    'DVC/BTC': '40',
		    'EAC/BTC': '139',
		    'ELC/BTC': '12',
		    'EMC2/BTC': '188',
		    'EMD/BTC': '69',
		    'EXE/BTC': '183',
		    'EZC/BTC': '47',
		    'FFC/BTC': '138',
		    'FLAP/BTC': '165',
		    'FLT/BTC': '192',
		    'FRC/BTC': '39',
		    'FRK/BTC': '33',
		    'FST/BTC': '44',
		    'FTC/BTC': '5',
		    'GDC/BTC': '82',
		    'GLC/BTC': '76',
		    'GLD/BTC': '30',
		    'GLX/BTC': '78',
		    'HBN/BTC': '80',
		    'HVC/BTC': '185',
		    'IFC/BTC': '59',
		    'IXC/BTC': '38',
		    'JKC/BTC': '25',
		    'KDC/BTC': '178',
		    'KGC/BTC': '65',
		    'LEAF/BTC': '148',
		    'LK7/BTC': '116',
		    'LKY/BTC': '34',
		    'LOT/BTC': '137',
		    'LTB/BTC': '202',
		    'LTC/BTC': '3',
		    'LYC/BTC': '177',
		    'MAX/BTC': '152',
		    'MEC/BTC': '45',
		    'MEOW/BTC': '149',
		    'MINT/BTC': '156',
		    'MN1/BTC': '187',
		    'MN2/BTC': '196',
		    'MNC/BTC': '7',
		    'MRY/BTC': '189',
		    'MYR/BTC': '200',
		    'MZC/BTC': '164',
		    'NAN/BTC': '64',
		    'NBL/BTC': '32',
		    'NEC/BTC': '90',
		    'NET/BTC': '134',
		    'NMC/BTC': '29',
		    'NRB/BTC': '54',
		    'NVC/BTC': '13',
		    'NXT/BTC': '159',
		    'NYAN/BTC': '184',
		    'ORB/BTC': '75',
		    'OSC/BTC': '144',
		    'PHS/BTC': '86',
		    'Points/BTC': '120',
		    'POT/BTC': '173',
		    'PPC/BTC': '28',
		    'PTS/BTC': '119',
		    'PXC/BTC': '31',
		    'PYC/BTC': '92',
		    'QRK/BTC': '71',
		    'RDD/BTC': '169',
		    'RPC/BTC': '143',
		    'RYC/BTC': '9',
		    'SAT/BTC': '168',
		    'SBC/BTC': '51',
		    'SMC/BTC': '158',
		    'SPA/BTC': '180',
		    'SPT/BTC': '81',
		    'SRC/BTC': '88',
		    'STR/BTC': '83',
		    'SXC/BTC': '153',
		    'TAG/BTC': '117',
		    'TAK/BTC': '166',
		    'TEK/BTC': '114',
		    'TGC/BTC': '130',
		    'TRC/BTC': '27',
		    'UNO/BTC': '133',
		    'USDe/BTC': '201',
		    'UTC/BTC': '163',
		    'VTC/BTC': '151',
		    'WC/BTC': '195',
		    'WDC/BTC': '14',
		    'XJO/BTC': '115',
		    'XPM/BTC': '63',
		    'YAC/BTC': '11',
		    'YBC/BTC': '73',
		    'ZCC/BTC': '140',
		    'ZED/BTC': '170',
		    'ZET/BTC': '85' };

	// Constructor
	function Cryptsy(key, secret){
		// Generate headers signed by this user's key and secret.
		// The secret is encapsulated and never exposed
		this._getPrivateHeaders = function(parameters){
			var paramString, signature;

			if (!key || !secret){
				throw 'Cryptsy: Error. API key and secret required';
			}

			// Sort parameters alphabetically and convert to `arg1=foo&arg2=bar`
			paramString = Object.keys(parameters).sort().map(function(param){
				return encodeURIComponent(param) + '=' + encodeURIComponent(parameters[param]);
			}).join('&');

			signature = crypto.createHmac('sha512', secret).update(paramString).digest('hex');

			return {
				Key: key,
					Sign: signature
			};
		};
	}



	// If a site uses non-trusted SSL certificates, set this value to false
	Cryptsy.STRICT_SSL = true;

	// Helper methods
	// Crypsty relies on marketIds for API calls not ticker symbols
	// Hence updated joinCurrencies to return marketID based on currency inputs

	function joinCurrencies(currencyA, currencyB){
		return MARKETS[currencyA + '/' + currencyB];	
	}
	// Prototype
	Cryptsy.prototype = {
		constructor: Cryptsy,

		// Make an API request
		_request: function(options, callback){
			if (!('headers' in options)){
				options.headers = {};
			}

			options.headers['User-Agent'] = USER_AGENT;
			options.json = true;
			options.strictSSL = Cryptsy.STRICT_SSL;

			request(options, function(err, response, body) {
				callback(err, body);
			});

			return this;
		},

		// Make a public API request
		_public: function(parameters, callback){
			var options = {
				method: 'GET',
				url: PUBLIC_API_URL,
				qs: parameters
			};

			return this._request(options, callback);
		},

		// Make a private API request
		_private: function(parameters, callback){
			var options;

			parameters.nonce = nonce();
			options = {
				method: 'POST',
				url: PRIVATE_API_URL,
				form: parameters,
				headers: this._getPrivateHeaders(parameters)
			};

			return this._request(options, callback);
		},


		/////


		// PUBLIC METHODS

		getTicker: function(callback){ //gets general market data from all markets
			var parameters = {
				method: 'marketdatav2'
			};

			return this._public(parameters, callback);
		},

		getSingleMarket: function(currencyA, currencyB, callback){ //gets general market data from single market
			var parameters = {
				method: 'singlemarketdata',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._public(parameters, callback);
		},

		getOrderBook: function(callback){ //orderbook for all Markets
			var parameters = {
				method: 'orderdatav2'
			};

			return this._public(parameters, callback);
		},

		getSingleOrderBook: function(currencyA, currencyB, callback){ //orderbook for single  Market
			var parameters = {
				method: 'orderdatav2',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._public(parameters, callback);
		},

		/////
		//if a method fails due to not finding a hardcoded market - call this method in the callback
		//on data.success != 1 to attempt
		//to update the Markets with the most recent and continue looping. 
		updateMarkets: function(callback){	
			this.getTicker(function(err, data){
				if (err || data.success != 1){
					return(err);
				}	
				MARKETS = [];
				data = data.return.markets;
				for(var keys in data){
					var trade = data[keys].label;
					var id = data[keys].marketid;
					MARKETS[trade] = id;
				}
			});
		},


		//////////
		// PRIVATE METHODS

		myBalances: function(callback){
			var parameters = {
				method: 'getinfo'
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of Active Markets 		
		myActiveMarkets: function(callback){
			var parameters = {
				method: 'getmarkets'
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of Wallet Statuses 		
		myWalletStatus: function(callback){
			var parameters = {
				method: 'getwalletstatus'
			};

			return this._private(parameters, callback);
		},
		
//Outputs: Array of Deposits and Withdrawals on your account 
		myTransactions: function(callback){
			var parameters = {
				method: 'mytransactions'
			};

			return this._private(parameters, callback);
		},

		//Outputs: Array of last 1000 Trades for this Market, in Date Decending Order 
		MarketTrades: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'markettrades',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

		//Outputs: 2 Arrays. First array is sellorders listing current open sell orders ordered price ascending.
		//Second array is buyorders listing current open buy orders ordered price descending. 
		MarketOrders: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'marketorders',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

//Outputs: Array your Trades for this Market, in Date Decending Order 		
		mySingleTrades: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'mytrades',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

		//Outputs: Array your Trades for all Markets, in Date Decending Order 
		myAllTrades: function(callback){
			var parameters = {
				method: 'allmytrades'
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of your orders for this market listing your current open sell and buy orders. 
		mySingleOrders: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'myorders',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of buy and sell orders on the market representing market depth. 
		depth: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'depth',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of all open orders for your account. 
		myAllOrders: function(callback){
			var parameters = {
				method: 'allmyorders',
			};

			return this._private(parameters, callback);
		},

//type = Buy OR Sell
//Outputs:
//orderid	If successful, the Order ID for the order which was created
		createOrder: function(currencyA, currencyB, type, quantity, price, callback){
			var parameters = {
				method: 'createorder',
				marketid: joinCurrencies(currencyA, currencyB),
				ordertype: type,
				quantity: quantity,
				price: price
			};

			return this._private(parameters, callback);
		},

//Outputs: n/a. If successful, it will return a success code. 
		cancelOrder: function(orderid, callback){
			var parameters = {
				method: 'cancelorder',
				orderid: orderid
			};

			return this._private(parameters, callback);
		},

//Cancels all orders for a specific market
		cancelMarketOrders: function(currencyA, currencyB, callback){
			var parameters = {
				method: 'cancelmarketorders',
				marketid: joinCurrencies(currencyA, currencyB)
			};

			return this._private(parameters, callback);
		},

		//Cancels ALL orders for ALL markets
		cancelAllOrders: function(callback){
			var parameters = {
				method: 'cancelallorders'
			};

			return this._private(parameters, callback);
		},


		calculateFees: function(ordertype, quantity, price, callback){
			var parameters = {
				method: 'calculatefees',
				ordertype: ordertype,
				quantity: quantity,
				price: price
			};

			return this._private(parameters, callback);
		},

//Outputs new address
		generateNewAddress: function(currencyA, callback){
			var parameters = {
				method: 'cancelallorders',
				currencycode: currencyA
			};

			return this._private(parameters, callback);
		},

//Outputs: Array of all transfers into/out of your account sorted by requested datetime descending. 
		myTransfers: function(callback){
			var parameters = {
				method: 'mytransfers'
			};

			return this._private(parameters, callback);
		},

		makeWithdrawal: function(address, amount, callback){
			var parameters = {
				method: 'withdraw',
				address: address,
				amount: amount
			};

			return this._private(parameters, callback);
		},

		myDepositAddress: function(callback){
			var parameters = {
				method: 'getmydepositaddress'
			};

			return this._private(parameters, callback);
		}
	};

	return Cryptsy;
}();

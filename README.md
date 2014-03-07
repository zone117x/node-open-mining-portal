# Stratum Portal

This portal is an extremely efficient, highly scalable, all-in-one, easy to setup cryptocurrency mining pool written
entirely in Node.js. It contains a [stratum poolserver](https://github.com/zone117x/node-stratum), reward/payment/share
processor (*not yet completed*), and front-end website (*not yet completed*).

Alternatively, this software also has an [MPOS](https://github.com/MPOS/php-mpos) compatibility mode so that the it can
function as a drop-in-replacement for [python-stratum-mining](https://github.com/Crypto-Expert/stratum-mining). This
mode can be enabled in the configuration and will insert shares into a MySQL database in the format which MPOS expects.

This software was built from the ground up to run with multiple coins simultaneously (which can have different
properties and hashing algorithms). It can be used to create a pool for a single coin or for multiple coins at once. The pools use clustering to load balance across multiple CPU cores.

For reward/payment processing, shares are inserted into a fast NoSQL key/value database (Redis). Each coin has a
processor that monitors for confirmed submitted blocks then send out payments according to shares accumulated in the
database. The payment/reward method used will be PROP (proportional) - where when a block is submitted and confirmed,
miners are paid based on their shares submitted during the round (a round is the process of searching for a single block).

This portal does not have user accounts/logins/registrations. Instead, miners simply use their coin address for stratum
authentication. A minimalistic HTML5 front-end connects to the portals statistics API to display stats from from each
pool such as connected miners, network/pool difficulty/hash rate, etc.


#### Planned Features

* To reduce variance for pools just starting out which have little to no hashing power a feature is planned which will
allow your own pool to connect upstream to a larger pool server. It will request work from the larger pool then
redistribute the work to our own connected miners.

* Automated switching of connected miners to different pools/coins is also easily done due to the multi-pool architecture
of this software. The switching can be controlled using a coin profitability API such as CoinChoose.com or CoinWarz.com
(or calculated locally using daemon-reported network difficulties and exchange APIs).




Usage
=====


#### Requirements
* Coin daemon(s)
* [Node.js](http://nodejs.org/) v0.10+
* [Redis](http://redis.io/) key-value store/database v2.6+


#### 1) Download

Clone the repository and run `npm update` for all the dependencies to be installed:

```bash
git clone https://github.com/zone117x/node-stratum-portal.git
npm update
```

#### 2) Setup

##### Portal config
Inside the `config.json` file, ensure the default configuration will work for your environment. The `clustering.forks`
option is set to `"auto"` by default which will spawn one process/fork/worker for each CPU core in your system.
Each of these workers will run a separate instance of your pool(s), and the kernel will load balance miners
using these forks. Optionally, the `clustering.forks` field can be a number for how many forks you wish to spawn.

With `blockNotifyListener` enabled, the master process will start listening on the configured port for messages from
the `scripts/blockNotify.js` script which your coin daemons can be configured to run when a new block is available.
When a blocknotify message is received, the master process uses IPC (inter-process communication) to notify each
worker process about the message. Each worker process then sends the message to the appropriate coin pool.
See "Setting up blocknotify" below to set up your daemon to use this feature.


##### Coin config
Inside the `coins` directory, ensure a json file exists for your coin. If it does not you will have to create it.
Here is an example of the required fields:
````javascript
{
    "name": "Litecoin",
    "symbol": "ltc",
    "algorithm": "scrypt", //or "sha256", "scrypt-jane", "quark", "x11"
    "reward": "POW", //or "POS"
    "txMessages": false //or true
}
````


##### Pool config
Take a look at the example json file inside the `pool_configs` directory. Rename it to `yourcoin.json` and change the
example fields to fit your setup. The field `coin` __must__ be a string that references the `name` field in your coin's
configuration file (the string is not case sensitive).

Description of options:

````javascript
{
    "disabled": false, //Set this to true and a pool will not be created from this config file
    "coin": "litecoin", //This MUST be a reference to the 'name' field in your coin's config file


    /* This determines what to do with submitted shares (and stratum worker authentication).
       You have two options: 
        1) Enable internal and disable mpos = this portal to handle all share payments.
        2) Enable mpos and disable internal = shares will be inserted into MySQL database
           for MPOS to process. */
    "shareProcessing": {

        "internal": {
            "enabled": true,

            /* When workers connect, to receive payments, their address must be used as the worker
               name. If this option is true, on worker authentication, their address will be
               verified via a validateaddress API call to the daemon. Miners with invalid addresses
               will be rejected. */
            "validateWorkerAddress": true,

            /* Every this many seconds check for confirmed blocks and send out payments. */
            "paymentInterval": 30,

            /* Minimum number of coins that a miner must earn before sending payment. Typically,
               a higher minimum means less transactions fees (you profit more) but miners see
               payments less frequently (they dislike). Opposite for a lower minimum payment. */
            "minimumPayment": 0.001,

            /* (2% default) What percent fee your pool takes from the block reward. */
            "feePercent": 0.02,

            /* Your address that receives pool revenue from fees */
            "feeReceiveAddress": "LZz44iyF4zLCXJTU8RxztyyJZBntdS6fvv",

            /* Minimum number of coins to keep in pool wallet */
            "minimumReserve": 10,

            /* How many coins from fee revenue must accumulate on top of the minimum reserve amount
               in order to trigger withdrawal to fee address. The higher this threshold, the less of
               your profit goes to transactions fees. */
            "feeWithdrawalThreshold": 5,

            /* This daemon is used to send out payments. It MUST be for the daemon that owns the
               configured 'address' that receives the block rewards, otherwise the daemon will not
               be able to confirm blocks or send out payments. */
            "daemon": {
                "host": "localhost",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            }
        },

        "mpos": { //Enabled this and shares will be inserted into share table in a MySQL database
            "enabled": false,
            "host": "localhost", //MySQL db host
            "port": 3306, //MySQL db port
            "user": "me", //MySQL db user
            "password": "mypass", //MySQL db password
            "database": "ltc", //MySQL db database name

            /* For when miner's authenticate: set to "password" for both worker name and password to
               be checked for in the database, set to "worker" for only work name to be checked, or
               don't use this option (set to "none") for no auth checks */
            "stratumAuth": "password"
        }
    },

    "address": "mi4iBXbBsydtcc5yFmsff2zCFVX4XG7qJc", //Address to where block rewards are given

    "blockRefreshInterval": 1000, //How often to poll RPC daemons for new blocks, in milliseconds

    //instanceId: 37, //Recommend not using this because a crypto-random one will be generated

    /* Some attackers will create thousands of workers that use up all available socket connections,
       usually the workers are zombies and don't submit shares after connecting. This feature
       detects those and disconnects them. */
    "connectionTimeout": 600, //Remove workers that haven't been in contact for this many seconds

    /* If a worker is submitting a high threshold of invalid shares we can temporarily ban them
       to reduce system/network load. Also useful to fight against flooding attacks. */
    "banning": {
        "enabled": true,
        "time": 600, //How many seconds to ban worker for
        "invalidPercent": 50, //What percent of invalid shares triggers ban
        "checkThreshold": 500, //Check invalid percent when this many shares have been submitted
        "purgeInterval": 300 //Every this many seconds clear out the list of old bans
    },

    /* Each pool can have as many ports for your miners to connect to as you wish. Each port can
       be configured to use its own pool difficulty and variable difficulty settings. varDiff is
       optional and will only be used for the ports you configure it for. */
    "ports": {
        "3032": { //A port for your miners to connect to
            "diff": 32, //the pool difficulty for this port

            /* Variable difficulty is a feature that will automatically adjust difficulty for
               individual miners based on their hashrate in order to lower networking overhead */
            "varDiff": {
                "minDiff": 8, //Minimum difficulty
                "maxDiff": 512, //Network difficulty will be used if it is lower than this
                "targetTime": 15, //Try to get 1 share per this many seconds
                "retargetTime": 90, //Check to see if we should retarget every this many seconds
                "variancePercent": 30 //Allow time to very this % from target without retargeting
            }
        },
        "3256": { //Another port for your miners to connect to, this port does not use varDiff
            "diff": 256 //The pool difficulty
        }
    },


    /* Recommended to have at least two daemon instances running in case one drops out-of-sync
       or offline. For redundancy, all instances will be polled for block/transaction updates
       and be used for submitting blocks. */
    "daemons": [
        {   //Main daemon instance
            "host": "localhost",
            "port": 19332,
            "user": "litecoinrpc",
            "password": "testnet"
        },
        {   //Backup daemon instance
            "host": "localhost",
            "port": 19344,
            "user": "litecoinrpc",
            "password": "testnet"
        }
    ],


    /* This allows the pool to connect to the daemon as a node peer to recieve block updates.
       It may be the most efficient way to get block updates (faster than polling, less
       intensive than blocknotify script). However its still under development (not yet working). */
    "p2p": {
        "enabled": false,
        "host": "localhost",
        "port": 19333,

        /* Magic value is different for main/testnet and for each coin. It is found in the daemon
           source code as the pchMessageStart variable.
           For example, litecoin mainnet magic: http://git.io/Bi8YFw
           And for litecoin testnet magic: http://git.io/NXBYJA
         */
        "magic": "fcc1b7dc",

        //Found in src as the PROTOCOL_VERSION variable, for example: http://git.io/KjuCrw
        "protocolVersion": 70002,
    }
}

````

You can create as many of these pool config files as you want (such as one pool per coin you which to operate).
If you are creating multiple pools, ensure that they have unique stratum ports.

For more information on these configuration options see the [pool module documentation](https://github.com/zone117x/node-stratum#module-usage)



##### [Optional, recommended] Setting up blocknotify
1. In `config.json` set the port and password for `blockNotifyListener`
2. In your daemon conf file set the `blocknotify` command to use:
```
[path to scripts/blockNotify.js] [listener host]:[listener port] [listener password] [coin name in config] %s
```
Example: inside `dogecoin.conf` add the line
```
blocknotify="scripts/blockNotify.js localhost:8117 mySuperSecurePassword dogecoin %s"
```




#### 3) Start the portal

```bash
node init.js
```

Optionally, use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
in case the master process crashes. 


Donations
---------
To support development of this project feel free to donate :)

BTC: 1KRotMnQpxu3sePQnsVLRy3EraRFYfJQFR

License
-------
Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html

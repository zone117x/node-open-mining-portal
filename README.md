# NOMP ![NOMP Logo](http://zone117x.github.io/node-open-mining-portal/logo.svg "NOMP Logo")
#### Node Open Mining Portal

This portal is an extremely efficient, highly scalable, all-in-one, easy to setup cryptocurrency mining pool written
entirely in Node.js. It contains a stratum poolserver, reward/payment/share processor, and a (*not yet completed*)
front-end website.

#### Features

* For the pool server it uses the highly efficient [node-stratum-pool](//github.com/zone117x/node-stratum-pool) module which
supports vardiff, POW & POS, transaction messages, anti-DDoS, IP banning, [several hashing algorithms](//github.com/zone117x/node-stratum-pool#hashing-algorithms-supported).

* The portal has an [MPOS](//github.com/MPOS/php-mpos) compatibility mode so that the it can
function as a drop-in-replacement for [python-stratum-mining](//github.com/Crypto-Expert/stratum-mining). This
mode can be enabled in the configuration and will insert shares into a MySQL database in the format which MPOS expects.

* Multi-pool ability - this software was built from the ground up to run with multiple coins simultaneously (which can
have different properties and hashing algorithms). It can be used to create a pool for a single coin or for multiple
coins at once. The pools use clustering to load balance across multiple CPU cores.

* For reward/payment processing, shares are inserted into Redis (a fast NoSQL key/value store). The PROP (proportional)
reward system is used with [Redis Transactions](http://redis.io/topics/transactions) for secure and super speedy payouts.
Each and every share will be rewarded - even for rounds resulting in orphaned blocks.

* This portal does not have user accounts/logins/registrations. Instead, miners simply use their coin address for stratum
authentication. A minimalistic HTML5 front-end connects to the portals statistics API to display stats from from each
pool such as connected miners, network/pool difficulty/hash rate, etc.


#### Planned Features

* NOMP API - Used by the website to display stats and information about the pool(s) on the portal's front-end website,
and by the NOMP Desktop app to retrieve a list of available coins (and version-bytes for local wallet/address generation).

* To reduce variance for pools just starting out which have little to no hashing power a feature is planned which will
allow your own pool to connect upstream to a larger pool server. It will request work from the larger pool then
redistribute the work to our own connected miners.

* Automated switching of connected miners to different pools/coins is also easily done due to the multi-pool architecture
of this software. The switching can be controlled using a coin profitability API such as CoinChoose.com or CoinWarz.com
(or calculated locally using daemon-reported network difficulties and exchange APIs).


#### Security
NOMP has some implicit security advantages for pool operators and miners:
* Without a registration/login system, non-security-oriented miners reusing passwords across pools is no longer a concern.
* Automated payouts by default and pool profits are sent to another address so pool wallets aren't plump with coins -
giving hackers little reward and keeping your pool from being a target.
* Miners can notice lack of automated payments as a possible early warning sign that an operator is about to run off with their coins.


#### Community / Support
IRC
* Support / general discussion join #nomp: https://webchat.freenode.net/?channels=#nomp
* Development discussion join #nomp-dev: https://webchat.freenode.net/?channels=#nomp-dev

Join our subreddit [/r/nomp](http://reddit.com/r/nomp)!

*Having problems getting the portal running due to some module dependency error?* It's probably because you
didn't follow the instructions in this README. Please __read the usage instructions__ including [requirements](#requirements) and [downloading/installing](#1-downloading--installing). If you've followed the instructions completely and are still having problems then open an issue here on github or join our #nomp IRC channel and explain your problem :).

If your pool uses NOMP let us know and we will list your website here.


Usage
=====


#### Requirements
* Coin daemon(s) (find the coin's repo and build latest version from source)
* [Node.js](http://nodejs.org/) v0.10+ ([follow these installation instructions](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager))
* [Redis](http://redis.io/) key-value store v2.6+ ([follow these instructions](http://redis.io/topics/quickstart))


#### 0) Setting up coin daemon
Follow the build/install instructions for your coin daemon. Your coin.conf file should end up looking something like this:
```
daemon=1
rpcuser=litecoinrpc
rpcpassword=securepassword
rpcport=19332
```
For redundancy, its recommended to have at least two daemon instances running in case one drops out-of-sync or offline,
all instances will be polled for block/transaction updates and be used for submitting blocks. Creating a backup daemon
involves spawning a daemon using the `-datadir=/backup` command-line argument which creates a new daemon instance with
it's own config directory and coin.conf file. Learn about the daemon, how to use it and how it works if you want to be
a good pool operator. For starters be sure to read:
   * https://en.bitcoin.it/wiki/Running_bitcoind
   * https://en.bitcoin.it/wiki/Data_directory
   * https://en.bitcoin.it/wiki/Original_Bitcoin_client/API_Calls_list
   * https://en.bitcoin.it/wiki/Difficulty

#### 1) Downloading & Installing

Clone the repository and run `npm update` for all the dependencies to be installed:

```bash
git clone https://github.com/zone117x/node-stratum-portal.git nomp
cd nomp
npm update
```

#### 2) Configuration

##### Portal config
Inside the `config.json` file, ensure the default configuration will work for your environment.

Explanation for each field:
````javascript
{
    /* Specifies the level of log output verbosity. Anything more severy than the level specified
       will also be logged. */
    "logLevel": "debug", //or "warning", "error"
    
    /* By default 'forks' is set to "auto" which will spawn one process/fork/worker for each CPU
       core in your system. Each of these workers will run a separate instance of your pool(s),
       and the kernel will load balance miners using these forks. Optionally, the 'forks' field
       can be a number for how many forks will be spawned. */
    "clustering": {
        "enabled": true,
        "forks": "auto"
    },
    
    /* With this enabled, the master process will start listening on the configured port for
       messages from the 'scripts/blockNotify.js' script which your coin daemons can be configured
       to run when a new block is available. When a blocknotify message is received, the master
       process uses IPC (inter-process communication) to notify each worker process about the
       message. Each worker process then sends the message to the appropriate coin pool. See
       "Setting up blocknotify" below to set up your daemon to use this feature. */
    "blockNotifyListener": {
        "enabled": true,
        "port": 8117,
        "password": "test"
    },
    
    /* This is the front-end. Its not finished. When it is finished, this comment will say so. */
    "website": {
        "enabled": true,
        "port": 80,
        "liveStats": true
    }
}
````


##### Coin config
Inside the `coins` directory, ensure a json file exists for your coin. If it does not you will have to create it.
Here is an example of the required fields:
````javascript
{
    "name": "Litecoin",
    "symbol": "ltc",
    "algorithm": "scrypt", //or "sha256", "scrypt-jane", "scrypt-n", "quark", "x11"
    "txMessages": false, //or true (not required, defaults to false)
}
````

For additional documentation how to configure coins *(especially important for scrypt-n and scrypt-jane coins)*
see [these instructions](//github.com/zone117x/node-stratum-pool#module-usage).


##### Pool config
Take a look at the example json file inside the `pool_configs` directory. Rename it to `yourcoin.json` and change the
example fields to fit your setup.

Description of options:

````javascript
{
    "enabled": true, //Set this to false and a pool will not be created from this config file
    "coin": "litecoin.json", //Reference to coin config file in 'coins' directory


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

            /* Every this many seconds get submitted blocks from redis, use daemon RPC to check
               their confirmation status, if confirmed then get shares from redis that contributed
               to block and send out payments. */
            "paymentInterval": 30,

            /* Minimum number of coins that a miner must earn before sending payment. Typically,
               a higher minimum means less transactions fees (you profit more) but miners see
               payments less frequently (they dislike). Opposite for a lower minimum payment. */
            "minimumPayment": 0.001,

            /* Minimum number of coins to keep in pool wallet. It is recommended to deposit at
               at least this many coins into the pool wallet when first starting the pool. */
            "minimumReserve": 10,

            /* (2% default) What percent fee your pool takes from the block reward. */
            "feePercent": 0.02,

            /* Name of the daemon account to use when moving coin profit within daemon wallet. */
            "feeCollectAccount": "feesCollected",

            /* Your address that receives pool revenue from fees. */
            "feeReceiveAddress": "LZz44iyF4zLCXJTU8RxztyyJZBntdS6fvv",

            /* How many coins from fee revenue must accumulate on top of the
               minimum reserve amount in order to trigger withdrawal to fee address. The higher
               this threshold, the less of your profit goes to transactions fees. */
            "feeWithdrawalThreshold": 5,

            /* This daemon is used to send out payments. It MUST be for the daemon that owns the
               configured 'address' that receives the block rewards, otherwise the daemon will not
               be able to confirm blocks or send out payments. */
            "daemon": {
                "host": "localhost",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            },

            /* Redis database used for storing share and block submission data. */
            "redis": {
                "host": "localhost",
                "port": 6379
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

    /* How many milliseconds should have passed before new block transactions will trigger a new
       job broadcast. */
    "txRefreshInterval": 20000,

    /* Some miner software is bugged and will consider the pool offline if it doesn't receive
       anything for around a minute, so every time we broadcast jobs, set a timeout to rebroadcast
       in this many seconds unless we find a new job. Set to zero or remove to disable this. */
    "jobRebroadcastTimeout": 55,

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

    /* For redundancy, recommended to have at least two daemon instances running in case one
       drops out-of-sync or offline. */
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

For more information on these configuration options see the [pool module documentation](https://github.com/zone117x/node-stratum-pool#module-usage)



##### [Optional, recommended] Setting up blocknotify
1. In `config.json` set the port and password for `blockNotifyListener`
2. In your daemon conf file set the `blocknotify` command to use:
```
node [path to scripts/blockNotify.js] [listener host]:[listener port] [listener password] [coin name in config] %s
```
Example: inside `dogecoin.conf` add the line
```
blocknotify="node scripts/blockNotify.js localhost:8117 mySuperSecurePassword dogecoin %s"
```




#### 3) Start the portal

```bash
node init.js
```

###### Optional enhancements for your awesome new mining pool server setup:
* Use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
in case the master process crashes. 
* Use something like [redis-commander](https://github.com/joeferner/redis-commander) to have a nice GUI
for exploring your redis database.
* Use something like [logrotator](http://www.thegeekstuff.com/2010/07/logrotate-examples/) to rotate log 
output from NOMP.
* Use [New Relic](http://newrelic.com/) to monitor your NOMP instance and server performance.


Donations
---------
To support development of this project feel free to donate :)

BTC: 1KRotMnQpxu3sePQnsVLRy3EraRFYfJQFR


Credits
-------
* [Tony Dobbs](http://anthonydobbs.com) - graphical help with logo and front-end design
* [vekexasia](//github.com/vekexasia) - co-developer & great tester
* [TheSeven](//github.com/TheSeven) - answering an absurd amount of my questions and being a very helpful gentleman
* [UdjinM6](//github.com/UdjinM6) - helped implement fee withdrawal in payment processing
* Those that contributed to [node-stratum-pool](//github.com/zone117x/node-stratum-pool)


License
-------
Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html

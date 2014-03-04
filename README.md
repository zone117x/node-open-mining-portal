# Stratum Portal

## Description
This portal is an extremely efficient, highly scalable, all-in-one, easy to setup cryptocurrency mining pool written
entirely in Node.js. It contains a [stratum poolserver](https://github.com/zone117x/node-stratum), reward/payment/share
processor (*not yet completed*), and front-end website (*not yet completed*).

It can be used to create a pool for a single coin or for multiple coins at once. The pools use clustering to load
balance across multiple CPU cores.

For reward/payment processing, shares are inserted into a fast NoSQL key/value database (Redis). Each coin has a
processor that monitors for confirmed submitted blocks then send out payments according to shares accumulated in the
database. The payment/reward method used will be PROP (proportional) - where when a block is submitted and confirmed,
miners are paid based on their shares submitted during the round (a round is the process of searching for a single block).

For those that wish to use this project with [MPOS](https://github.com/MPOS/php-mpos), the portal can be configured
to insert shares into a MySQL database in the format which MPOS expects.

This portal does not have user accounts/logins/registrations. Instead, miners simply use their coin address for stratum
authentication. A minimalistic HTML5 front-end connects to the portals statistics API to display stats from from each
pool such as connected miners, network/pool difficulty/hash rate, etc.

To reduce variance for pools just starting out which have little to no hashing power a feature is planned which will
allow your own pool to connect upstream to a larger pool server. It will request work from the larger pool then
redistribute the work to our own connected miners.

Automated switching of connected miners to different pools/coins is also easily done due to the multi-pool architecture
of this software. The switching can be controlled using a coin profitability API such as CoinChoose.com or CoinWarz.com
(or calculated locally using daemon-reported network difficulties and exchange APIs).




Usage
=====

#### 1) Download

```bash
git clone https://github.com/zone117x/node-stratum-portal.git
cd node-stratum-portal
git clone https://github.com/zone117x/node-stratum node_modules/stratum-pool
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
Here is an example of the required fields
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
    "address": "mi4iBXbBsydtcc5yFmsff2zCFVX4XG7qJc", //address to where block rewards are given
    "blockRefreshInterval": 1000 //how often to poll RPC daemons for new blocks, in milliseconds
    //instanceId: 37, //Recommend not using this because a crypto-random one will be generated


    /* Each pool can have as many ports for your miners to connect to as you wish. Each port can
       be configured to use its own pool difficulty and variable difficulty settings. varDiff is
       optional and will only be used for the ports you configure it for. */
    "ports": {
        "3032": { //a port for your miners to connect to
            "diff": 32, //the pool difficulty for this port

            /* Variable difficulty is a feature that will automatically adjust difficulty for
               individual miners based on their hashrate in order to lower networking overhead */
            "varDiff": {
                "minDiff": 8, //minimum difficulty
                "maxDiff": 512, //network difficulty will be used if it is lower than this
                "targetTime": 15, //try to get 1 share per this many seconds
                "retargetTime": 90, //check to see if we should retarget every this many seconds
                "variancePercent": 30 //allow time to very this % from target without retargeting
            }
        },
        "3256": { //another port for your miners to connect to, this port does not use varDiff
            "diff": 256 //the pool difficulty
        }
    },


    /* This determines what to do with submitted shares. You have two options: 1) Enable internal
       and disable mpos which will allow this portal to handle all share payments.2) Enable mpos
       and disabled internal which wil allow MPOS to handle all share payments. */
    "shareProcessing": {
        "internal": { //enabled this options for share payments to be processed and sent locally
            "enabled": true,
            /* This daemon is used to send out payments. It MUST be for the daemon that owns the
               'pool.address' field below, otherwise the daemon will not be able to confirm blocks
               or sent out payments. */
            "daemon": {
                "host": "localhost",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            }
        },
        "mpos": { //enabled this and shares will be inserted into share table in a MySql database
            "enabled": false,
            "host": "localhost",
            "port": 3306,
            "user": "me",
            "password": "mypass",
            "database": "ltc"
        }
    },


    /* RPC daemons for block update polling and submitting blocks - recommended to have at least two
       for redundancy in case one dies or goes out-of-sync */
    "daemons": [
        {   //main daemon instance
            "host": "localhost",
            "port": 19332,
            "user": "litecoinrpc",
            "password": "testnet"
        },
        {   //backup daemon instance
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

        // Found in src as the PROTOCOL_VERSION variable, for example: http://git.io/KjuCrw
        "protocolVersion": 70002,

    }
}

````

You can create as many of these pool config files as you want (such as one pool per coin you which to operate).
If you are creating multiple pools, ensure that they have unique stratum ports with the `pool.stratumPort` field.

For more information on these configuration options see the [pool module documentation](https://github.com/zone117x/node-stratum#module-usage)

##### [Optional, recommended] Setting up blocknotify
  * In `config.json` set the port and password for `blockNotifyListener`
  * In your daemon conf file set the `blocknotify` command to use:

    ```
    [path to scripts/blockNotify.js] [listener host]:[listener port] [listener password] [coin name in config]
    %s"
    ```

    * Example: `dogecoin.conf` > `blocknotify="scripts/blockNotify.js localhost:8117 mySuperSecurePassword dogecoin %s"`



#### 3) Start the portal

```bash
node init.js
```


Donations
---------
To support development of this project feel free to donate :)

BTC: 1KRotMnQpxu3sePQnsVLRy3EraRFYfJQFR

License
-------
Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html
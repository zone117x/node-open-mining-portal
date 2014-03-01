# Stratum Portal

## Goal of this project
When ready, this portal will be able to spawn pools for all configured coins/cryptocurrencies.
Each pool will take advantage of clustering to load balance across multiple CPU cores and be
extremely efficient.

For reward/payment processing, shares will be inserted into a fast NoSQL key/value database such as Redis.
Each coin will have a processor that monitors for confirmed submitted blocks then send out payments
according to shares accumulated in the database.

For now the plan is to not have user accounts, but rather, have miners use their coin address for
stratum authentication. This portal will come with a minimalistic HTML5 front-end that displays
statistics from from each pool such as connected miners, network/pool difficulty/hash rate, etc.

To reduce variance for pools just starting out which have little to no hashing power a feature
could be added that connects upstream to a larger pool server. After receiving work from the larger
pool it would then be redistributed to our connected miners.

Another great feature would be utilizing the multi-pool ability of this portal to allow a connected
miner to be switched from one pool/coin to another. The switching can be controlled using a coin
profitability API such as CoinChoose.com or CoinWarz.com.




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
````json
{
    "name": "Litecoin",
    "symbol": "ltc",
    "algorithm": "scrypt",
    "reward": "POW",
    "txMessages": false
}
````

##### Pool config
Create a json file inside the `pool_configs` directory. Take a look at the example json file provided to see
which fields are required. The field `coin` __must__ be a string that references the `name` field in your coin's
configuration file (the string is not case sensitive).

You can create as many of these pool config files as you want (such as one pool per coin you which to operate).
If you are creating multiple pools, ensure that they have unique stratum ports with the `pool.stratumPort` field.


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
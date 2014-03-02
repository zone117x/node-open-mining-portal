# Stratum Portal

## Description
This portal is an extremely efficient, highly scalable, all-in-one, easy to setup cryptocurrency mining pool written
entirely in Node.js. It contains a [stratum poolserver](https://github.com/zone117x/node-stratum), reward/payment/share
processor (*not yet completed*), and front-end website (*not yet completed*).

It can be used to create a pool for a single coin or for multiple coins at once. The pools use clustering to load
balance across multiple CPU cores.

For reward/payment processing, shares are inserted into a fast NoSQL key/value database (Redis). Each coin has a
processor that monitors for confirmed submitted blocks then send out payments according to shares accumulated in the
database.

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
    "algorithm": "scrypt",
    "reward": "POW",
    "txMessages": false
}
````
For more information on these configuration options see the [pool module documentation](https://github.com/zone117x/node-stratum#module-usage)

##### Pool config
Create a json file inside the `pool_configs` directory. Take a look at the example json file provided to see
which fields are required. The field `coin` __must__ be a string that references the `name` field in your coin's
configuration file (the string is not case sensitive).

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
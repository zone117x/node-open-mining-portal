# Stratum Portal

## Goal of this project
When ready, this portal will be able to spawn pools for all configured coins/cryptocurrencies.
Each pool will take advantage of clustering to load balance across multiple CPU cores and be
extremely efficient.

For reward/payment processing, shares will be inserted into a fast NoSQL database such as Redis.
Each coin will have a processor that monitors for confirmed submitted blocks then send out payments
according to shares accumulated in the database.

For now the plan is to not have user accounts, but rather, have miners use their coin address for
stratum authentication. This portal will come with a minimalistic HTML5 front-end that displays
statistics from from each pool such as connected miners, network/pool difficulty/hash rate, etc.

To reduce variance for pools just starting out which have little to no hashing power a feature
could be added that connects upstream to a larger pool server. After receiving work from the larger
pool it would then be redistributed to our connected miners.

Another great feature would be utilizing the multi-pool ability of this portal to do coin
auto-switching using an coin profitability API such as CoinChoose.com


#### [Optional, recommended] Setting up blocknotify
  * In `config.json` set the port and password for `blockNotifyListener`
  * For the blocknotify arguments in your daemon startup parameters or conf file, use:

    ```
    [path to blockNotify.js]
    [pool host]:[pool blockNotifyListener port]
    [blockNotifyListener password]
    [coin symbol set in coin's json config]
    %s"
    ```

    * Example: `dogecoind -blocknotify="scripts/blockNotify.js localhost:8117 mySuperSecurePassword doge %s"`
    * If your daemon is on a different host you will have to copy over `scripts/blockNotify.js`



Setup for development of stratum-pool
=====================================

```
git clone https://github.com/zone117x/node-stratum-portal.git
cd node-stratum-portal
git clone https://github.com/zone117x/node-stratum node_modules/stratum-pool
npm update
node init.js
```
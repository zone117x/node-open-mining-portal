// Using cross-fetch until node.js exposes undici for all LTS versions
const fetch = require('cross-fetch');
const https = require('https');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Asynchronous simple bitcoin daemon client
 * 
 * Queries over HTTP POST requests
 * 
 * Returns resolved promise if no error, rejects otherwise
 * 
 * We don't log or catch errors here, should happen on the function that consumes data
 */
class DaemonAsync {
  constructor(daemon) {
    this.daemon = daemon;
    this.id = 0;
  }

  // jsonData should be string
  async fetch(instance, jsonData) {
    const host = instance.host || '127.0.0.1'
    const port = instance.port
    const url = instance.https
      ? `https://${host}${port ? `:${port}` : ''}`
      : `http://${host}${port ? `:${port}` : ''}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(instance.user + ':' + instance.password)}`,
        'Content-Length': jsonData.length
      },
      body: jsonData,
      agent: instance.https ? httpsAgent : undefined
    })
      
    return resp.json()
  }

  async cmd(method, params) {
    const requestJson = {
      id: this.id,
      method,
      params
    }
    this.id++;

    const result = await this.fetch(this.daemon, JSON.stringify(requestJson));

    if (result.error) {
      throw new Error(JSON.stringify(result.error));
    }

    return result.result;
  }

  // On TypeScript put generics here
  async batchCmd(cmdArray, throwError = true) {
    const requestJson = cmdArray.map(([method, params]) => {
      const req = {
        id: this.id,
        method,
        params
      }
      this.id++;
      return req;
    });

    const results = await this.fetch(this.daemon, JSON.stringify(requestJson));

    if (results.error) {
      throw new Error(JSON.stringify(results.error));
    }

    return results.map(({ result, error }) => {
      if (error) {
        if (throwError) {
          throw new Error(error);
        }
        return {
          ...(result || {}),
          error
        }
      }
      return result
    });
  }

  async isOnline() {
    try {
      await this.cmd('getnetworkinfo', []);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = DaemonAsync;

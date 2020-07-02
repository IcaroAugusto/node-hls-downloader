const fs = require('fs');
const Parser = require('m3u8-parser').Parser;
const https = require('https');
const crypto = require('crypto');

const _defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:99.0) Gecko/20100101 Firefox/99.0',
  'Accept': '*/*',
}

async function read(url, headers) {
  var chunks = [];
  return new Promise(resolve => {
    https.get(url, {headers}, res => {
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function readStr(url, headers) {
  return (await read(url, headers)).toString();
}

function parse(m3u8) {
  var parser = new Parser();
  parser.push(m3u8);
  parser.end();
  return parser.manifest;
}

function between(a, b, c) {
  return a >= b && a <= c;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function translate(algo) {
  switch (algo) {
    case 'AES-128': return 'AES-128-CBC';
    default: return algo;
  }
}

function decrypt(buffer, algo, key, iv) {
  var decipher = crypto.createDecipheriv(translate(algo), key, iv);
  decipher.setAutoPadding(true);
  var result = Buffer.concat([decipher.update(buffer), decipher.final()]);
  var extra = result.length % 16;
  return extra > 0 ? result.slice(1, result.length-extra) : result.slice(1);
}

function trim(arr, length) {
  if (arr.length > length) {
    return arr.slice(Math.max(arr.length-length, 0), arr.length);
  }
  return arr;
}

function getBaseUrl(url) {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

class HLSDownloader {
  constructor(params = {}) {
    this.url = params.url;
    this.file = params.file;
    this.headers = params.headers || _defaultHeaders;
    this.maxRes = params.maxRes || 5000;
    this.minRes = params.minRes || 0;
    this.sorting = params.sorting || 'best';
    this.retries = params.retries || 0;
    this.retryDelay = params.retryDelay || 1000;
    this.sortMultiplier = this.sorting == 'best' ? 1 : -1;
    this.running = false;
    this.playlist = null;
    this.keys = [];
    this.cache = [];
  }

  select(baseurl, playlists) {
    var uri = playlists
      .filter(pl => between(pl.attributes.RESOLUTION.height, this.minRes, this.maxRes))
      .sort((a, b) => this.sortMultiplier*(b.attributes.RESOLUTION.height - a.attributes.RESOLUTION.height))[0].uri
    ;
    return uri.includes('http') ? uri : baseurl + uri;
  }

  getKey(key) {
    return this.keys.find(k => k.method == key.method && k.uri == key.uri && k.iv == key.iv);
  }

  async grabKey(baseurl, key) {
    var result = {
      key: await read(key.uri.includes('http') ? key.uri : baseurl + key.uri, this.headers),
      method: key.method,
      uri: key.uri,
    };
    this.keys.push(result);
    this.keys = trim(this.keys, 100);
    return result;
  }

  makeIv(sequence) {
    var result = Buffer.from(sequence.toString());
    return result.length >= 16 ? result : Buffer.concat([Buffer.from(new Array(16-result.length).fill(0)), result]);
  }

  async download(baseurl, segment, sequence) {
    var data = await read(segment.uri.includes('http') ? segment.uri : baseurl + segment.uri, this.headers);
    if (!segment.key) return data;
    var key = this.getKey(segment.key);
    if (!key) key = await this.grabKey(baseurl, segment.key);
    return decrypt(data, key.method, key.key, key.iv ? key.iv : this.makeIv(sequence));
  }

  async downloadSegments(baseurl, segments, mediaSequence) {
    var promises = [];
    for (var i = 0; i < segments.length; i++) {
      if (!this.cache.includes(segments[i].uri)) {
        promises.push(this.download(baseurl, segments[i], mediaSequence + i));
        this.cache.push(segments[i].uri);
      }
    }
    (await Promise.all(promises)).forEach(s => fs.appendFileSync(this.file, s));
    this.cache = trim(this.cache, 100);
  }

  async run() {
    this.running = true;
    var retries = 0;
    while (this.running) {
      var url = this.playlist ? this.playlist : this.url;
      var manifest = parse(await readStr(url, this.headers));
      if (manifest.segments && manifest.segments.length > 0) {
        await this.downloadSegments(getBaseUrl(url), manifest.segments, manifest.mediaSequence);
        await sleep(manifest.targetDuration ? 1000*manifest.targetDuration : 1000);
        continue;
      }
      if (!manifest.playlists || manifest.playlists.length == 0) {
        this.playlist = null;
        if (retries < this.retries) {
          retries += 1;
          await sleep(this.retryDelay);
          continue;
        }
        this.running = false;
        return;
      }
      this.playlist = this.select(getBaseUrl(url), manifest.playlists);
      retries = 0;
    }
  }

  stop() {
    this.running = false;
  }
}

module.exports = HLSDownloader;
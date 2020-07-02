# Node.js HLS Downloader

This has been written for usage with [https://leakgirls.com](https://leakgirls.com), but can be used to download/record any HLS stream.

* Audio and video must be in the same stream;
* It supports encrypted streams;
* Segments are simply downloaded and appended to the given file.

## Usage

```JavaScript
const HLSRecorder = require('hls-recorder');

async function main() {
  var downloader = new HLSRecorder({
    url: 'm3u8 url',
    file: 'ts file',
    headers: 'request headers', //look at the code for defaults
    maxRes: 1200, //maximum resolution (video height)
    minRes: 0, //minimum resolution (video height)
    sorting: 'best', //best or worst, how to select playlists
    retries: 3, //how many times to retry when request fails or returns empty playlist/segments
    retryDelay: 2000, //ms to wait between each retry attempt
  });
  setTimeout(() => downloader.stop(), 30000);
  await downloader.run();
}

main();
```

### 1.0.0
* Released.
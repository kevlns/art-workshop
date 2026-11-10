import { once } from 'node:events';

// Fetch's bad-port table, checked against the installed DSH undici
// lib/web/fetch/constants.js. Windows may allocate these with listen(0):
// this machine's dynamic TCP range starts at 1024, rather than 49152.
const blockedPorts = new Set([
  1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,
  87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,
  139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,
  540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,
  2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,
  6669,6679,6697,10080,
]);

// Choose the listener before any business request. This does not retry HTTP
// requests or hide network failures, and sends no probe request to the fixture.
export async function listenForFetch(server) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!blockedPorts.has(address.port)) return address;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  throw new Error('Unable to allocate a Fetch-compatible fixture port.');
}

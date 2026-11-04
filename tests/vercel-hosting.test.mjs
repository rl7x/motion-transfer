import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createVercelProxy, createSandboxIngress } from '../src/hosting/vercel-proxy.mjs';
import { localMetaClient } from '../src/hosting/local-parallaxia.mjs';
import { createVercelWorkerBroker } from '../src/hosting/vercel-worker-client.mjs';

const key = 'test-proxy-credential-'.repeat(3);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const send = (url, options = {}) => new Promise((resolve, reject) => {
  const request = httpRequest(url, options, response => {
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
  });
  request.on('error',reject);request.end(options.body);
});

test('moving the spending ledger to Vercel disables local inference instead of forking its allowance', () => {
  assert.equal(localMetaClient({MODEL_API_KEY:'fixture-key'},{remoteLedger:true}),null);
  assert.equal(localMetaClient({},{remoteLedger:false}),null);
  assert.equal(typeof localMetaClient({MODEL_API_KEY:'fixture-key'},{remoteLedger:false}).respond,'function');
});

test('the cloud worker transport rejects command injection and restores exact frame bytes', async () => {
  const calls=[];const frame=Buffer.from([0,255,1,2]);
  const broker=createVercelWorkerBroker({origin:'https://play.example',proxyKey:key,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});
    return new Response(JSON.stringify(options.method==='POST'?{name:'motion-worker-fixture'}:{ok:true,frame:frame.toString('base64')}),{status:200});
  }});
  await assert.rejects(()=>broker.submit({operation:'probe-env',command:'echo unsafe'}),/Arbitrary command/);
  assert.equal(calls.length,0);
  const result=await broker.submit({operation:'probe-env'});
  assert.equal(result.ok,true);assert.deepEqual(result.frame,frame);
  assert.equal(calls.length,2);assert.equal(calls[0].options.headers['x-motion-proxy-key'],key);
});

test('Vercel rejects forged hosts, cross-origin writes, broad recovery and oversized requests before waking a sandbox', async () => {
  let wakes = 0;
  const server = createServer(createVercelProxy({ proxyKey: key, hosts: ['play.example'],
    getBackend: async () => { wakes++; return 'https://backend.example'; } }));
  const origin = await listen(server);
  try {
    const cases = [
      [{headers:{host:'evil.example'}},403,'/'],
      [{headers:{host:'play.example'}},404,'/_motion/health'],
      [{method:'POST',headers:{host:'play.example',origin:'https://evil.example','content-type':'application/json'},body:'{}'},403,'/api/remixes'],
      [{method:'POST',headers:{host:'play.example',origin:'https://play.example','content-type':'application/json'},body:'{}'},403,'/api/investigations'],
      [{method:'POST',headers:{host:'play.example',origin:'https://play.example','content-type':'application/json'},body:'x'.repeat(4097)},413,'/api/remixes'],
    ];
    for(const [options,status,path] of cases) assert.equal((await send(origin+path,options)).status,status,path);
    assert.equal(wakes,0);
  } finally { await close(server); }
});

test('the Function keeps the credential private and preserves exact binary downloads and frame sandbox headers', async () => {
  const payload=Buffer.from([0,255,80,75,3,4]);
  let received;
  const server=createServer(createVercelProxy({proxyKey:key,hosts:['play.example'],getBackend:async()=>'https://backend.example',
    fetchImpl:async(url,options)=>{received={url:url.href,options};return new Response(payload,{headers:{'content-type':'application/zip','content-security-policy':'sandbox allow-scripts','content-disposition':'attachment; filename="game.zip"','x-motion-proxy-key':key}});}}));
  const origin=await listen(server);
  try {
    const response=await send(origin+'/artifacts/abc/download.zip',{headers:{host:'play.example','x-motion-proxy-key':'forged'}});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload);
    assert.equal(received.url,'https://backend.example/artifacts/abc/download.zip');
    assert.equal(received.options.headers['x-motion-proxy-key'],key);
    assert.equal(response.headers.get('x-motion-proxy-key'),null);
    assert.equal(response.headers.get('content-security-policy'),'sandbox allow-scripts');
    assert.equal(response.headers.get('content-type'),'application/zip');
  } finally {await close(server);}
});

test('a same-origin remix reaches the loopback application, while direct sandbox traffic stays unauthorized', async () => {
  const received=[];
  const preview=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    received.push({url:request.url,origin:request.headers.origin,body:Buffer.concat(chunks).toString(),key:request.headers['x-motion-proxy-key']});
    response.writeHead(202,{'Content-Type':'application/json'});response.end('{"id":"same-job"}');
  });
  const previewOrigin=await listen(preview);
  const ingress=await createSandboxIngress({previewOrigin,proxyKey:key,host:'127.0.0.1',port:0});
  const gateway=createServer(createVercelProxy({proxyKey:key,hosts:['play.example'],getBackend:async()=>ingress.origin}));
  const origin=await listen(gateway);
  try {
    assert.equal((await fetch(ingress.origin+'/api/remixes',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(ingress.origin+'/_motion/health',{headers:{'x-motion-proxy-key':key}})).status,200);
    const response=await send(origin+'/api/remixes',{method:'POST',headers:{host:'play.example',origin:'https://play.example','content-type':'application/json'},body:'{"prompt":"half as far"}'});
    assert.equal(response.status,202);assert.deepEqual(await response.json(),{id:'same-job'});
    assert.deepEqual(received,[{url:'/api/remixes',origin:previewOrigin,body:'{"prompt":"half as far"}',key:undefined}]);
  } finally {await close(gateway);await ingress.close();await close(preview);}
});

const savedSite = {
  async read(url) {
    const files = {
      '/ported/skyhaul/after/index.html': ['<!doctype html><title>saved</title>', 'text/html'],
      '/api/catalog': [JSON.stringify({ versions: [1], generationConfigured: true }), 'application/json'],
      '/api/remixes/status': [JSON.stringify({ ok: true, generationConfigured: true }), 'application/json'],
    };
    return files[url] ? { bytes: Buffer.from(files[url][0]), headers: { 'content-type': files[url][1] } } : null;
  },
};

test('saved games play with the backend paused, and generation reads as paused', async () => {
  let wakes = 0;
  const server = createServer(createVercelProxy({ proxyKey: key, hosts: ['play.example'], snapshot: savedSite,
    getBackend: async () => { wakes++; throw Error('quota paused'); } }));
  const origin = await listen(server);
  try {
    const game = await send(origin + '/ported/skyhaul/after/index.html', { headers: { host: 'play.example' } });
    assert.equal(game.status, 200);
    assert.equal(game.headers.get('x-motion-snapshot'), '1');
    assert.equal(wakes, 0, 'A saved game must not wake the sandbox');
    assert.match(await game.text(), /saved/);
    const status = await send(origin + '/api/remixes/status', { headers: { host: 'play.example' } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).generationConfigured, false);
    const catalog = await send(origin + '/api/catalog', { headers: { host: 'play.example' } });
    assert.deepEqual(await catalog.json(), { versions: [1], generationConfigured: false });
    assert.equal(wakes, 2);
    const unknown = await send(origin + '/artifacts/' + 'a'.repeat(64), { headers: { host: 'play.example' } });
    assert.equal(unknown.status, 503);
  } finally { await close(server); }
});

test('a slow wake gets the saved catalog now, keeps generation available, and finishes in the background', async () => {
  let finished = false, kept = null;
  const slow = new Promise(resolve => { setTimeout(() => { finished = true; resolve('https://backend.example'); }, 4300); });
  const server = createServer(createVercelProxy({ proxyKey: key, hosts: ['play.example'], snapshot: savedSite,
    getBackend: () => slow, background: promise => { kept = promise; } }));
  const origin = await listen(server);
  try {
    const started = Date.now();
    const response = await send(origin + '/api/catalog', { headers: { host: 'play.example' } });
    assert.ok(Date.now() - started < 4250, 'The saved copy must not wait for the wake');
    assert.equal(response.headers.get('x-motion-snapshot'), '1');
    assert.equal((await response.json()).generationConfigured, true);
    assert.equal(finished, false);
    assert.ok(kept, 'The wake must keep running after the response');
    await kept;
    assert.equal(finished, true);
  } finally { await close(server); }
});

test('a running backend answers live reads and writes even when a snapshot exists', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(new URL(url).pathname); return new Response(JSON.stringify({ versions: [1, 2] }), { headers: { 'content-type': 'application/json' } }); };
  const server = createServer(createVercelProxy({ proxyKey: key, hosts: ['play.example'], snapshot: savedSite, fetchImpl,
    getBackend: async () => 'https://backend.example' }));
  const origin = await listen(server);
  try {
    const response = await send(origin + '/api/catalog', { headers: { host: 'play.example' } });
    assert.equal(response.headers.get('x-motion-snapshot'), null);
    assert.deepEqual(await response.json(), { versions: [1, 2] });
    const write = await send(origin + '/api/remixes', { method: 'POST', body: '{}',
      headers: { host: 'play.example', origin: 'https://play.example', 'content-type': 'application/json' } });
    assert.equal(write.status, 200);
    assert.deepEqual(calls, ['/api/catalog', '/api/remixes']);
  } finally { await close(server); }
});

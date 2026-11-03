/** Trusted React replay UI plus exact parent bytes; never compile or execute generated source here. */
export function addReplayToArchive(files,{parentFrame=null,replayScript=null}={}){
 if(parentFrame)files['parent.html']=parentFrame;
 if(parentFrame&&replayScript&&files['experiment.json']){
  const json=JSON.stringify(JSON.parse(files['experiment.json'].toString())).replace(/</g,'\\u003c');
  const script=replayScript.toString().replace(/<\/script/gi,'<\\/script');
  files['replay.html']=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved PARALLAXIA experiment</title><style>body{margin:24px;background:#101412;color:#e5eadf;font:16px system-ui}main{max-width:1100px;margin:auto}button,a{color:inherit}button{background:#34402e;padding:12px}td,th{text-align:left;padding:8px}.experiment-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}iframe{width:100%;height:60vh;border:0}@media(max-width:600px){.experiment-comparison{grid-template-columns:1fr}}</style></head><body><div id="export-root"></div><script id="experiment-data" type="application/json">${json}</script><script>${script}</script></body></html>`;
 }
 return files;
}

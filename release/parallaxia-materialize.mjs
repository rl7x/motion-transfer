import { addReplayToArchive } from '../hosting/export.mjs';
import { buildExportedExperiment } from '../web/build.mjs';
import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { zipStored } from './zip.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export async function materializeParallaxia(release){
 const files={...release.extras};
 const replayScript=await buildExportedExperiment();
 const data={generation:'playback-only',recovery:'accepted',featuredRecipient:'parallaxia',featuredArtifactId:release.featuredId===release.baseline.id?undefined:release.featuredId,
   publicOrigin:release.publicOrigin,jujumpComparison:release.jujumpComparison,resources:release.resources};
 files['motion-data.json']=JSON.stringify(data,null,2)+'\n';
 files['release-boot.js']=await readFile(new URL('boot.js',import.meta.url),'utf8');files['app.js']=release.shell.appJs;files['style.css']=release.shell.css;
 const json=JSON.stringify(data).replace(/</g,'\\u003c');
 files['index.html']=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion Transfer · PARALLAXIA</title><link rel="stylesheet" href="style.css"></head><body><div data-share-state="unconfigured"><p>Creation is unavailable on this static copy. Saved results are playback-only reuse.</p></div><div id="root"></div><script id="motion-data" type="application/json">${json}</script><script src="release-boot.js"></script><script type="module" src="app.js"></script></body></html>`;
 for(const version of release.versions){
  const base=`versions/${version.id}/`;
  const payload={...version.originalFiles,'verification.json':version.evidenceBytes,
    'recovered-component.ts':release.component.source,'recovered-component.js':release.component.javascript,
    'component-provenance.json':JSON.stringify(release.component.provenance,null,2)+'\n',
    'lineage.json':JSON.stringify({componentId:release.componentId,parentArtifactId:version.parentArtifactId,artifactId:version.id,origin:version.origin},null,2)+'\n'};
  addReplayToArchive(payload,{parentFrame:release.versions.find(item=>item.id===version.parentArtifactId)?.frame,replayScript});
  payload['README.txt']='Motion Transfer · PARALLAXIA\nOpen play.html (or frame.html for the baseline) in a browser. It needs no model, development server or dependency install. Arrow keys/WASD move, Space/Z shoots, X dashes.\nThe recovered component, adapter, rule module, notices and exact verification evidence are included. If replay.html is present, open it to replay both original and candidate from the frozen checkpoint at normal speed. This is saved reuse. Native collisions remain active. The separately labeled practice challenge uses a shield.\n';
  const source={id:version.id,componentId:release.componentId,recipient:release.recipient,origin:version.origin,
    scope:'Original playable/source/evidence bytes are retained. Additional archive documentation and explicit component files are bound by this export manifest and the release manifest.',
    files:Object.fromEntries(Object.entries(payload).map(([name,bytes])=>[name,digest(bytes)]))};
  for(const [name,bytes]of Object.entries(payload))files[base+name]=bytes;
  files[base+'source.json']=JSON.stringify(source,null,2)+'\n';files[base+'download.zip']=zipStored(payload);files[base+'frame.html']=version.frame;
  const parent=version.parentArtifactId?`<a data-parent href="../${version.parentArtifactId}/index.html">Parent version</a>`:'';
  files[base+'index.html']=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(version.title)}</title></head><body data-share-state="unconfigured"><h1>${escape(version.title)}</h1><p>Creation is unavailable. This saved result is reuse.</p><iframe title="Saved PARALLAXIA version" src="frame.html" sandbox="allow-scripts" style="width:100%;height:70vh;border:0"></iframe><p>${parent} <a href="download.zip">Download exact game and evidence</a> <a href="source.json">Export hashes</a> <a href="notices.txt">Notices</a></p></body></html>`;
  const api=version.id===release.baseline.id?`parallaxia/artifacts/${version.id}/`:`artifacts/${version.id}/`;
  files[api+'play.html']=version.frame;files[api+'download.html']=version.frame;files[api+'download.zip']=files[base+'download.zip'];
  files[api+'report.json']=version.evidenceBytes;files[api+'receipt.json']=version.evidenceBytes;
  files[api+'adapter.ts']=version.adapter;files[api+'notices.txt']=version.notices;
  for(const [name,bytes]of Object.entries(version.originalFiles))files[api+name]=bytes;
  files[`parents/${version.id}.html`]=version.frame;
 }
 const catalog=release.versions.map(version=>`<li><a href="versions/${version.id}/index.html">${escape(version.title)} · ${version.id.slice(0,12)}</a></li>`).join('');
 files['versions.html']=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Saved PARALLAXIA versions</title><h1>Saved results</h1><p>Creation is unavailable. Unsuccessful experiments remain labeled.</p><ul>${catalog}</ul><a href="index.html">Workbench</a></html>`;
 return files;
}

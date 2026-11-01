const $=selector=>document.querySelector(selector);
const svgElement=(name,attributes={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
async function json(path){const response=await fetch(path);if(!response.ok)throw Error('Saved evidence is unavailable');return response.json();}
try{
  const ability=await json('/api/ability');
  const evaluations=await Promise.all(['development','regressions','acceptance'].map(name=>json(`/evidence/evaluation-${name}.json`)));
  const cases=evaluations.flatMap(report=>report.results??[]);
  const ticks=cases.reduce((total,item)=>total+item.ticks,0),error=Math.max(...cases.map(item=>item.maxPositionError));
  $('#recovery-verdict').textContent=`Saved verification: ${cases.length} motion traces, ${ticks.toLocaleString()} logical updates, maximum measured position error ${error} source pixels. These finite checks used the default configuration and body width 8.`;
  $('#shared-component').title=ability.id;
}catch(error){$('#recovery-verdict').textContent=error.message;}
try{
  const comparison=await json('/evidence/transfer-comparison.json');
  if(!comparison.passed)throw Error('No passing comparison is saved');
  const svg=svgElement('svg',{viewBox:'0 0 1000 260',role:'img','aria-label':'Actual dash-only travel over 100 logical updates, normalized to donor pixels. All four executions match.'});
  const title=svgElement('title');title.textContent='One frozen controller across four actual executions';svg.append(title);
  const colors=['#e8e2ce','#c3ed89','#90c7e8','#c5a8ec'];
  comparison.lanes.forEach((lane,index)=>{
    const top=16+index*57,baseline=top+36;
    const label=svgElement('text',{x:14,y:top+18,fill:colors[index],'font-size':12,'font-family':'monospace'});label.textContent=lane.name;svg.append(label);
    const axis=svgElement('line',{x1:195,y1:baseline,x2:920,y2:baseline,stroke:'#34432e'});svg.append(axis);
    for(const tick of comparison.activationTicks){const line=svgElement('line',{x1:195+(tick-1)/99*725,y1:top,x2:195+(tick-1)/99*725,y2:baseline,stroke:'#405236','stroke-dasharray':'2 4'});svg.append(line);}
    const path=svgElement('polyline',{points:lane.frames.map(frame=>`${195+(frame.tick-1)/99*725},${baseline-frame.cumulativeSourcePixels/180*30}`).join(' '),fill:'none',stroke:colors[index],'stroke-width':2});
    const tooltip=svgElement('title');tooltip.textContent=`${lane.name}: activations ${comparison.activationTicks.join(', ')}; ${lane.frames.at(-1).cumulativeSourcePixels} donor-equivalent dash pixels.`;path.append(tooltip);svg.append(path);
    const distance=svgElement('text',{x:932,y:top+18,fill:colors[index],'font-size':11,'font-family':'monospace'});distance.textContent=lane.frames.reduce((sum,frame)=>sum+frame.pixels,0)+'px';svg.append(distance);
  });
  for(const tick of [1,33,66,100]){
    const label=svgElement('text',{x:195+(tick-1)/99*725,y:252,fill:'#a4b397','font-size':10,'font-family':'monospace','text-anchor':tick===100?'end':'start'});
    label.textContent=tick===1?'tick 1':String(tick);svg.append(label);
  }
  const metrics=document.createElement('div');metrics.className='trace-metrics';
  for(const text of ['Every dash: 60 → 30 recipient pixels','Active: 8 updates','Recharge: 25 updates']){const item=document.createElement('span');item.textContent=text;metrics.append(item);}
  const caption=document.createElement('p');caption.className='trace-caption';caption.textContent='Actual dash-only travel over 100 updates. Curves use donor-equivalent units; totals at right use each game’s own pixels. Dashed lines mark activation. Controlled free-space fixtures; see scope below.';
  $('#trace-comparison').replaceChildren(svg,metrics,caption);
  const airborne=comparison.airborne,first=airborne.transfer[0],last=airborne.transfer.at(-1);
  const note=document.createElement('p');note.className='airborne-result';
  note.textContent=`Gravity stays with JUJUMP: during the same eight updates, the dash moves 30 horizontal pixels while ordinary motion moves 8. Both fall from screen y=${first.p.y.toFixed(2)} to y=${last.p.y.toFixed(2)} with matching vertical velocity. Camera scrolling is retained. These are matched open-air fixtures; platform landing is tested separately.`;
  $('#airborne-comparison').replaceChildren(note);
}catch(error){$('#trace-comparison').textContent=error.message+'. Open the saved destination reports for the available checks.';}

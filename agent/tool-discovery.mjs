import {TOOLS} from './tool-schema.mjs';
import {validateSchema} from './schema.mjs';
import {recoveryPolicy} from './recovery-protocol.mjs';

const essential=['inspect_wasm','prepare_checkpoint','run_experiment','run_experiment_program','record_finding'];
const recoveryEssential=[...essential,'list_functions','inspect_function','decompile_function',
  'call_graph','trace_writers','read_checkpoint','read_experiment','select_component_evidence'];
const recoveryStages={
  investigate:recoveryEssential,
  select:['select_component_evidence','inspect_function','decompile_function','read_experiment','trace_writers','call_graph'],
  develop:['submit_component_candidate','inspect_function','decompile_function','read_experiment',
    'prepare_checkpoint','run_experiment','select_component_evidence'],
  freeze:['freeze_component'],accept:['accept_component'],conclude:[],
};
const groups={
  static:{description:'Inspect compiled WASM code, direct call graphs, evidence-linked names and actual scalar writers.',names:['list_functions','inspect_function','decompile_function','call_graph','annotate_function','trace_writers']},
  execution:{description:'Observe or reconstruct checkpoint state, read compact experiment evidence and selectively capture actual images.',names:['read_checkpoint','read_experiment','capture_experiment','session_observe','session_advance','checkpoint_state','session_reset','run_original']},
  memory:{description:'Specialized low-level typed memory and branch tools. Complete experiments normally use run_experiment instead.',names:['read_memory','write_memory','diff_memory','fork_checkpoint','compare_branches','capture_frame']},
  recovery:{description:'Select inspected code and execution evidence, develop component candidates, freeze source and run separate acceptance.',names:['select_component_evidence','submit_component_candidate','freeze_component','accept_component']},
};
const search={type:'tool_search',execution:'client',description:'Load one focused project tool namespace. Orientation and complete experiment/program tools are already available. Choose static, execution, memory or recovery; the application returns only its registered deferred definitions.',parameters:{type:'object',properties:{namespace:{type:'string',enum:Object.keys(groups)}},required:['namespace'],additionalProperties:false}};

export function createToolDiscovery({mode='none',model,state,profile='general',recoveryProtocol}={}){
  if(!['none','client'].includes(mode))throw Error('Only flat tools or client-executed Meta tool search are supported');
  if(!['general','recovery'].includes(profile))throw Error('Unknown investigation tool profile');
  if(mode==='client'&&model!=='muse-spark-1.3')throw Error('Native discovery is verified against the documented muse-spark-1.3 protocol only; the configured model was not changed');
  const record=state??{mode,loadedNamespaces:[],exchanges:[],limitations:['Hosted search is disabled: cumulative server-side iterations cannot be bounded by the existing one-request token reservation.']};
  if(profile==='recovery')record.profile='recovery';
  let available=profile==='recovery'?recoveryEssential:essential;
  if(record.mode!==mode||record.loadedNamespaces.some(name=>!Object.hasOwn(groups,name)))throw Error('Tool discovery state mismatch');
  const byName=new Map(TOOLS.map(tool=>[tool.name,tool]));
  const policy=recoveryPolicy(recoveryProtocol);
  return{
    state:record,
    resetDeferredContext(){
      // Compaction starts a fresh stateless context with no pending calls. Keep
      // the original exchanges for audit, but require rediscovery before routing
      // a specialized namespace that is no longer present in model context.
      for(const exchange of record.exchanges)exchange.replay=false;
      record.loadedNamespaces=[];
    },
    definitions({stage='investigate',programsRemaining=true,reserveDevelopment=false}={}){
      if(profile==='recovery'){
        if(!Object.hasOwn(recoveryStages,stage))throw Error('Unknown recovery stage');
        available=(stage==='select'&&reserveDevelopment?['select_component_evidence']:recoveryStages[stage])
          .filter(name=>programsRemaining||name!=='run_experiment_program');
        return available.map(name=>{
          const tool=byName.get(name);
          return name==='submit_component_candidate'&&recoveryProtocol
            ? {...tool,description:tool.description.replace('Three attempts maximum.',`${policy.maxDevelopmentAttempts} behavioral attempts maximum.`)}:tool;
        });
      }
      return mode==='none'?TOOLS:[...available.map(name=>byName.get(name)),search];
    },
    validateResponse(output){
      for(const item of output)if(item.type==='tool_search_call'&&(mode!=='client'||item.execution!=='client'))throw Error('Hosted or unsupported tool search cannot fit the existing reservation controls; no retry or provider switch was made');
      for(const item of output)if(item.type==='tool_search_output')throw Error('Unexpected provider-loaded tools; client discovery accepts only the local registered catalog');
    },
    route(call){
      if(profile==='recovery'){
        if(call.namespace!=null||!available.includes(call.name))throw Error('Tool is not available in the current recovery stage; use its directly listed tools');
        return call.name;
      }
      if(mode==='none'){if(call.namespace!=null)throw Error('Unexpected function namespace in flat tool mode');if(!byName.has(call.name))throw Error('Unknown function tool');return call.name;}
      if(call.namespace==null){if(!available.includes(call.name))throw Error('Specialized functions require their loaded namespace');return call.name;}
      const group=groups[call.namespace];
      if(!group||!record.loadedNamespaces.includes(call.namespace)||!group.names.includes(call.name))throw Error('Function namespace is unknown, unloaded or does not contain this tool');
      return call.name;
    },
    load(call){
      if(profile==='recovery')throw Error('Recovery tools are directly available for the current stage; no tool search is needed');
      if(mode!=='client'||call.execution!=='client'||typeof call.call_id!=='string'||!call.call_id)throw Error('Invalid client tool search call');
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;validateSchema(args,search.parameters);
      const group=groups[args.namespace],tools=[{type:'namespace',name:args.namespace,description:group.description,tools:group.names.map(name=>({...byName.get(name),defer_loading:true}))}];
      const output={type:'tool_search_output',execution:'client',call_id:call.call_id,status:'completed',tools};
      record.exchanges.push({call:structuredClone(call),output:structuredClone(output)});
      if(!record.loadedNamespaces.includes(args.namespace))record.loadedNamespaces.push(args.namespace);
      return{args,output,result:{namespace:args.namespace,loadedFunctions:group.names,execution:'client',catalogSource:'Registered local definitions; no extra model/provider was called'}};
    },
    failedSearch(call){const output={type:'tool_search_output',execution:'client',call_id:call.call_id,status:'completed',tools:[]};record.exchanges.push({call:structuredClone(call),output});return output;},
  };
}

export function discoveryReplay(report){return(report.toolDiscovery?.exchanges??[]).filter(exchange=>exchange.replay!==false).flatMap(exchange=>[exchange.call,exchange.output]);}

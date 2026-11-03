import * as THREE from 'three';
import {createDashPresentation,DASH_PRESENTATION} from './dash-presentation.mjs';

export function createDashVisuals(app,{reducedMotion=false,enabled=true}={}){
  const state=createDashPresentation({reducedMotion:reducedMotion||!enabled});
  const ghosts=[],rotation=new THREE.Euler(0,0,0,'ZXY');let renders=0,heldRenders=0,lastView=null,presentedPose=null;
  const capture=()=>({position:app.roadster.root.position.clone(),quaternion:app.roadster.root.quaternion.clone(),cameraPosition:app.renderer.camera.position.clone(),cameraQuaternion:app.renderer.camera.quaternion.clone()});
  const restore=view=>{app.roadster.root.position.copy(view.position);app.roadster.root.quaternion.copy(view.quaternion);app.roadster.root.updateMatrixWorld(true);app.renderer.camera.position.copy(view.cameraPosition);app.renderer.camera.quaternion.copy(view.cameraQuaternion);app.renderer.camera.updateMatrixWorld(true);};
  function allocate(){
    while(ghosts.length<DASH_PRESENTATION.maxAfterimages){
      const root=app.roadster.root.clone(true),material=new THREE.MeshBasicMaterial({color:0xb8f5eb,transparent:true,opacity:0,depthWrite:false,toneMapped:false});
      const lights=[];
      root.traverse(object=>{
        if(object.isLight)lights.push(object);
        if(object.isMesh){object.material=material;object.castShadow=false;object.receiveShadow=false;}
      });
      for(const light of lights)light.removeFromParent();
      root.name='transferred-dash-afterimage';root.visible=false;app.renderer.scene.add(root);ghosts.push({root,material});
    }
  }
  return{
    observe:sample=>state.observe(sample),
    reset(){state.reset();lastView=null;presentedPose=null;for(const ghost of ghosts)ghost.root.visible=false;},
    render(draw){
      const effect=state.snapshot();
      if(effect.afterimages.length&&!ghosts.length)allocate();
      for(let i=0;i<ghosts.length;i++){
        const ghost=ghosts[i],image=effect.afterimages[i];ghost.root.visible=Boolean(image)&&!effect.hold;
        if(!image)continue;
        ghost.root.position.set(image.pose.x,image.pose.y,0);
        ghost.root.quaternion.setFromEuler(rotation.set(image.pose.roll,0,image.pose.pitch,'ZXY'));
        ghost.material.opacity=image.opacity;
      }
      const current=capture();
      if(effect.hold&&lastView){heldRenders++;restore(lastView);}
      else lastView=current;
      presentedPose=app.roadster.root.position.toArray();
      try{renders++;draw();}finally{restore(current);}
    },
    snapshot(){return{...state.snapshot(),renders,heldRenders,presentedPose,visibleAfterimages:ghosts.filter(ghost=>ghost.root.visible).length};},
  };
}

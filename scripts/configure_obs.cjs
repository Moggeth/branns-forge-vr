const {connect}=require('./obs_rpc.cjs');
(async()=>{const c=await connect();try{
 const status=await c.call('GetRecordStatus'); if(status.outputActive)throw Error('Stop recording before configuring OBS.');
 const profile=await c.call('GetProfileList');if(profile.currentProfileName!=='Branns Forge Silent')throw Error('Select the Branns Forge Silent profile first.');
 const scene='Branns Forge',name='Brann game only';
 const inputs=await c.call('GetInputList');
 if(!inputs.inputs.some(i=>i.inputName===name))await c.call('CreateInput',{sceneName:scene,inputName:name,inputKind:'window_capture',inputSettings:{method:2,cursor:false,client_area:true,capture_audio:false},sceneItemEnabled:true});
 const windows=await c.call('GetInputPropertiesListPropertyItems',{inputName:name,propertyName:'window'});
 const match=windows.propertyItems.filter(w=>w.itemName.includes("Brann's Forge VR")&&w.itemEnabled);
 if(match.length!==1)throw Error('Open exactly one Brann game window before configuring capture.');
 await c.call('SetInputSettings',{inputName:name,inputSettings:{window:match[0].itemValue,method:2,priority:0,cursor:false,client_area:true,capture_audio:false},overlay:false});
 const {sceneItemId}=await c.call('GetSceneItemId',{sceneName:scene,sourceName:name});
 await c.call('SetSceneItemTransform',{sceneName:scene,sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:1280,boundsHeight:800,boundsAlignment:0}});
 // Disable every audio source in the dedicated collection, including default devices.
 for(const i of (await c.call('GetInputList')).inputs){try{await c.call('SetInputMute',{inputName:i.inputName,inputMuted:true});}catch{}}
 await c.call('SetCurrentProgramScene',{sceneName:scene});
 console.log('Game-only WGC capture configured, 1280x800 at 30 fps, silent NVENC recording.');
}finally{c.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});

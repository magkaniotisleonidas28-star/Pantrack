// The dev client reloads its page once a restarted server answers. That reload
// aborts a navigation started at the same moment, so leave the page first.
export async function restartDetached({page,stop,start}){
 await page.goto('about:blank');await stop();return start();
}
// The launcher's supervisor polls with the fixture credential and exits 1 once it
// is revoked, so stop the launcher first. Revocation then runs against the app
// alone; every file is attempted and the app is always stopped.
export async function stopThenRevoke({stop,files,startApp,revoke}){
 const failures=[];
 if(stop)try{await stop();}catch(e){failures.push(e);}
 if(files.length){
  let app;
  try{app=await startApp();for(const file of files)try{await revoke(file);}catch(e){failures.push(e);}}
  catch(e){failures.push(e);}
  finally{if(app)try{await app.stop();}catch(e){failures.push(e);}}
 }
 if(failures.length===1)throw failures[0];
 if(failures.length)throw new AggregateError(failures,'Launcher cleanup failed.');
}
// Cleanup always runs. A cleanup failure must not replace the original failure.
export async function withCleanup(body,cleanup){
 let failure;
 try{return await body();}
 catch(e){failure=e;throw e;}
 finally{
  try{await cleanup();}
  catch(e){if(!failure)throw e;throw new AggregateError([failure,e],'Check and its cleanup failed.');}
 }
}

// The dev client reloads its page once a restarted server answers. That reload
// aborts a navigation started at the same moment, so leave the page first.
export async function restartDetached({page,stop,start}){
 await page.goto('about:blank');await stop();return start();
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

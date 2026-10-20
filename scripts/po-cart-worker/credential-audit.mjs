const quote=value=>`'${String(value).replaceAll("'","''")}'`;

// execute returns true only after successful SQL execution, including no-op
// cleanup of an absent/already-revoked row. Neither dependency's errors are evidence.
export async function auditCredentials({credentials,execute,request=fetch,origin='http://127.0.0.1:5181',now=()=>new Date().toISOString()}){
 const results=[];
 for(const c of credentials){
  let status=null,revoked=false;
  try{
   const sql=`UPDATE po_cart_worker_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,${quote(now())}) WHERE id=${quote(c.credentialId)} AND worker_id=${quote(c.workerId)} AND status='active';`;
   revoked=await execute(sql)===true;
  }catch{}
  // SQL failure must not prevent the independent authorization check or cleanup
  // of subsequent captured credentials (including partially issued credentials).
  try{
   const response=await request(origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+c.secret},signal:AbortSignal.timeout(10000)});
   status=response.status;await response.body?.cancel();
  }catch{}
  results.push({credentialId:c.credentialId,revoked,status});
 }
 return {passed:results.every(r=>r.revoked&&r.status===401),count:results.length,results};
}

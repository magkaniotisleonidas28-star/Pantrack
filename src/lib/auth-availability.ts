export class SessionUnavailableError extends Error{
  constructor(){super('Authentication is temporarily unavailable. Please retry.');}
}
export function sessionUnavailableResponse(){
  return Response.json({error:new SessionUnavailableError().message},{status:503,headers:{'Cache-Control':'private, no-store'}});
}
export function withSessionAvailability(handler:(req:Request)=>Promise<Response>){
  return async(req:Request)=>{
    try{return await handler(req);}catch(error){if(error instanceof SessionUnavailableError)return sessionUnavailableResponse();throw error;}
  };
}

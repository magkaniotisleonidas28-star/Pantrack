// Only deliberately authored application messages may cross an API boundary.
// Do not wrap unexpected database, provider, crypto or runtime error text.
export class UserFacingError extends Error {}

export function userFacingMessage(error:unknown,fallback:string):string{
 return error instanceof UserFacingError?error.message:fallback;
}

/** Owned bytes prevent asynchronous mutation while Web Crypto hashes the input. */
export async function documentByteDigest(bytes:Uint8Array){
  const value=new Uint8Array(bytes);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
}

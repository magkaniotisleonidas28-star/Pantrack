import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readPrivate,writePrivate} from './private-files.mjs';
import type {Fixture} from '../cart-preview/store';
import type {BrowserConfig} from '../../src/lib/po-cart-browser-contract';
import type {CartEntry} from '../../src/lib/cart-preview-contract';
// Storefront state alone. Application jobs/leases/attempts/evidence live exclusively in D1.
export class BrowserFixtureStore {
 state:{fixtures:Record<string,Fixture>};
 constructor(readonly path:string){this.state=existsSync(path)?readPrivate(path):{fixtures:{}};this.save();}
 refresh(){if(existsSync(this.path)){const next=readPrivate(this.path);for(const [id,fixture] of Object.entries(next.fixtures) as [string,Fixture][])Object.assign(this.state.fixtures[id]??=fixture,fixture);}}
 save(){writePrivate(this.path,this.state);}
 provision(jobId:string,config:BrowserConfig,entries:CartEntry[]=[{sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'}]){
  if(this.state.fixtures[jobId])throw Error('Fixture session already provisioned.');
  const fixture:Fixture={...config,entries:structuredClone(entries),token:randomUUID(),loggedIn:config.scenario!=='login_expired',lost:false};
  this.state.fixtures[jobId]=fixture;this.save();return fixture;
 }
}

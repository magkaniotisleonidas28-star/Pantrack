import {D1PurchaseOrderDrafts} from './d1-purchase-order-drafts';
import {CartPreparationError, preparationRequestSchema, preparationPreflight,
  assertPreparationUnchanged, type PreparationConnection, type PreparationPreflight} from './po-cart-preparation-contract';

/** Read-only authorization preflight. No job/grant, network, reservations or inventory writes. */
export class D1PoCartPreparation {
  constructor(private readonly db:D1Database, private readonly options:{
    identity:()=>Promise<string|null>;
    connection:(companyId:string)=>Promise<PreparationConnection>;
  }) {}

  private async actor(companyId:string):Promise<string> {
    const actor = await this.options.identity();
    const member = actor && await this.db.prepare("SELECT role FROM memberships WHERE company_id=? AND user_id=?")
      .bind(companyId,actor).first<{role:string}>();
    if (!actor || !member || !['owner','manager'].includes(member.role)) {
      throw new CartPreparationError('forbidden','Current manager or owner membership is required.');
    }
    return actor;
  }

  async inspect(value:unknown):Promise<PreparationPreflight> {
    const parsed = preparationRequestSchema.safeParse(value);
    if (!parsed.success) throw new CartPreparationError('invalid_request','Choose a saved PO, revision and operation identity.');
    const request = parsed.data, actor = await this.actor(request.companyId);
    const order = await new D1PurchaseOrderDrafts(this.db,{identity:async()=>actor})
      .get(request.companyId,request.orderId);
    const connection = await this.options.connection(request.companyId);
    if (await this.actor(request.companyId) !== actor) throw new CartPreparationError('forbidden','Session changed during preflight.');
    return preparationPreflight(request,actor,order,connection);
  }

  async revalidate(value:unknown, previous:PreparationPreflight):Promise<PreparationPreflight> {
    const current = await this.inspect(value);
    assertPreparationUnchanged(previous,current);
    return current;
  }
}

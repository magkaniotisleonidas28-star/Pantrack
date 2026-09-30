import {withCompanyRoute} from '@/lib/authorization';
import {handleWaste} from '@/lib/waste-route';
export const GET=withCompanyRoute('waste-shortcuts',req=>handleWaste(req,true));
export const POST=withCompanyRoute('waste-shortcuts',req=>handleWaste(req,true));

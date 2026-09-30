import {withCompanyRoute} from '@/lib/authorization';
import {handleWaste} from '@/lib/waste-route';
export const GET=withCompanyRoute('waste',req=>handleWaste(req));
export const POST=withCompanyRoute('waste',req=>handleWaste(req));

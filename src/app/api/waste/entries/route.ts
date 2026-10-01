import {withCompanyRoute} from '@/lib/authorization';
import {handleMenuWaste} from '@/lib/menu-waste-route';
export const POST=withCompanyRoute('waste',req=>handleMenuWaste(req,'entries'));

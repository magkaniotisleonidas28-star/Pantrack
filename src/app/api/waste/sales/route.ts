import {withCompanyRoute} from '@/lib/authorization';
import {handleMenuWaste} from '@/lib/menu-waste-route';
export const GET=withCompanyRoute('waste',req=>handleMenuWaste(req,'sales'));

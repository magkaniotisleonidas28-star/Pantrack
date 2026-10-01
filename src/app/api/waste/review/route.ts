import {withCompanyRoute} from '@/lib/authorization';
import {handleMenuWaste} from '@/lib/menu-waste-route';
export const GET=withCompanyRoute('waste-shortcuts',req=>handleMenuWaste(req,'review'));
export const POST=withCompanyRoute('waste-shortcuts',req=>handleMenuWaste(req,'review'));

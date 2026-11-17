import { withCompanyRoute } from '@/lib/authorization';
import { handleWastePhotoSettings } from '@/lib/waste-suggestion-route';
export const GET = withCompanyRoute('waste-photo', (req) => handleWastePhotoSettings(req));
export const POST = withCompanyRoute('waste-photo', (req) => handleWastePhotoSettings(req));

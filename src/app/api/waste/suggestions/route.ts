import { withCompanyRoute } from '@/lib/authorization';
import { handleWasteSuggestion } from '@/lib/waste-suggestion-route';
export const POST = withCompanyRoute('waste', (req) => handleWasteSuggestion(req));

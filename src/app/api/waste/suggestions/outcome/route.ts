import { withCompanyRoute } from '@/lib/authorization';
import { handleWasteSuggestionOutcome } from '@/lib/waste-suggestion-route';
export const POST = withCompanyRoute('waste', (req) => handleWasteSuggestionOutcome(req));

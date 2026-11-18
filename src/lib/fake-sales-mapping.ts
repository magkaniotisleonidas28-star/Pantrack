import {
  type SalesSourceBinding,
  type SalesMappingResult,
  type SalesModifierMappingResult,
  type SalesMappingPort,
  clone,
} from '@/lib/sales-event-model';

type FakeLineMapping = {
  companyId: string;
  provider: string;
  externalItemId: string;
  externalVariationId?: string;
  recipeId: string;
};

type FakeModifierMapping = FakeLineMapping & { externalModifierId: string; modifierId: string };

export class FakeSalesMappingPort implements SalesMappingPort {
  constructor(
    private readonly lineMappings: FakeLineMapping[] = [],
    private readonly modifierMappings: FakeModifierMapping[] = [],
  ) {}

  setLine(mapping: FakeLineMapping) {
    this.lineMappings.push(clone(mapping));
  }

  setModifier(mapping: FakeModifierMapping) {
    this.modifierMappings.push(clone(mapping));
  }

  async resolveLine(input: {
    companyId: string;
    source: SalesSourceBinding;
    externalItemId: string;
    externalVariationId?: string;
  }): Promise<SalesMappingResult> {
    const candidates = this.lineMappings.filter(
      (item) =>
        item.companyId === input.companyId &&
        item.provider === input.source.provider &&
        item.externalItemId === input.externalItemId,
    );
    const mapping = candidates.find(
      (item) => item.externalVariationId === input.externalVariationId,
    );
    if (mapping) return { status: 'mapped', recipeId: mapping.recipeId };
    return { status: candidates.length ? 'unknown_variation' : 'unknown_item' };
  }

  async resolveModifier(input: {
    companyId: string;
    source: SalesSourceBinding;
    externalItemId: string;
    externalVariationId?: string;
    externalModifierId: string;
  }): Promise<SalesModifierMappingResult> {
    const mapping = this.modifierMappings.find(
      (item) =>
        item.companyId === input.companyId &&
        item.provider === input.source.provider &&
        item.externalItemId === input.externalItemId &&
        item.externalVariationId === input.externalVariationId &&
        item.externalModifierId === input.externalModifierId,
    );
    return mapping
      ? { status: 'mapped', modifierId: mapping.modifierId }
      : { status: 'unknown_modifier' };
  }
}

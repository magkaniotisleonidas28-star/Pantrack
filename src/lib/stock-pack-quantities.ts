import type {ExactQuantity} from './inventory-consumption-contract';
import type {PackageQuantityInput} from './inventory-management-contract';
import {curatedUnit,readCanonical,toCanonical,QuantityError,type UnitDefinition,type ProductScope} from './inventory-quantities';

const scaleFor=(q:ExactQuantity)=>q.dimension==='count'?BigInt(1):BigInt(1000000);

/** A package is a configured amount, never a guessed mass/volume conversion. */
export function packageTotal(pack:ExactQuantity,input:PackageQuantityInput,measurement:UnitDefinition,scope:ProductScope):ExactQuantity {
  if(!/^(?:0|[1-9]\d{0,6})$/.test(input.packages))throw new QuantityError('invalid_quantity','Enter a whole number of packages, up to 1,000,000.');
  if(BigInt(input.packages)>BigInt(1000000)||readCanonical(pack)<=BigInt(0))throw new QuantityError('invalid_quantity','Check the package count and package size.');
  const remainderUnit=input.remainderUnitId===measurement.id?measurement:curatedUnit(input.remainderUnitId);
  const remainder=toCanonical(input.remainder,remainderUnit,scope,{dimension:pack.dimension});
  const result={dimension:pack.dimension,minor:(readCanonical(pack)*BigInt(input.packages)+readCanonical(remainder)).toString()};
  readCanonical(result);return result;
}

function decimalRatio(numerator:bigint,denominator:bigint,places:number):string {
  const scale=BigInt(10)**BigInt(places),negative=numerator<BigInt(0),absolute=negative?-numerator:numerator;
  const raw=absolute*scale,rounded=raw/denominator+(raw%denominator*BigInt(2)>=denominator?BigInt(1):BigInt(0));
  const text=rounded.toString().padStart(places+1,'0');
  const value=places?text.slice(0,-places)+'.'+text.slice(-places):text;
  return (negative&&rounded!==BigInt(0)?'-':'')+value.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}

/** Display only; rounded presentation must never feed inventory calculations. */
export function formatInUnit(q:ExactQuantity,unit:UnitDefinition,places=3):string {
  if(q.dimension!==unit.dimension)throw new QuantityError('unit_incompatible','Choose a measurement of the same type.');
  return decimalRatio(readCanonical(q)*BigInt(unit.denominator),scaleFor(q)*BigInt(unit.numerator),places);
}
export function packageEquivalent(q:ExactQuantity,pack:ExactQuantity):string {
  if(q.dimension!==pack.dimension||readCanonical(pack)<=BigInt(0))throw new QuantityError('unit_incompatible','Package size is unavailable.');
  return decimalRatio(readCanonical(q),readCanonical(pack),2);
}

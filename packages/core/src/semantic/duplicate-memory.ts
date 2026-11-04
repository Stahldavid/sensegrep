/** The budget covers the additional Float64 distance cache and normalized vectors,
 * not source strings or vectors already loaded from the index. */
export function planDuplicateMemory(count:number,dimension:number,metric:string,configuredMiB=128) {
  if (!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(dimension)||dimension<0) throw new RangeError('Invalid duplicate candidate dimensions')
  if (!Number.isFinite(configuredMiB)||configuredMiB<0||configuredMiB>4096) throw new RangeError('SENSEGREP_DUPLICATE_MEMORY_MIB must be between 0 and 4096')
  const estimatedAdditionalBytes=8*(count*(count-1)/2+count*dimension)
  const memoryBudgetBytes=Math.floor(configuredMiB*1024*1024)
  const eligible=metric==='cosine'&&count<=4096&&Number.isSafeInteger(estimatedAdditionalBytes)&&estimatedAdditionalBytes<=memoryBudgetBytes
  return {strategy:eligible?'memory-cosine' as const:'vector-store' as const,estimatedAdditionalBytes,memoryBudgetBytes,
    reason:metric!=='cosine'?'distance-metric':count>4096?'candidate-limit':!eligible?'memory-budget':'within-budget'}
}

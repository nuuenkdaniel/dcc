export const classificationRetryKey='_classificationRetry'
export type ClassificationRetry={version:1;attempts:number;nextAttemptAt:string}

export function parseClassificationRetry(value:unknown):ClassificationRetry|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const retry=value as Record<string,unknown>
 if(retry.version!==1||typeof retry.attempts!=='number'||!Number.isSafeInteger(retry.attempts)||retry.attempts<1||retry.attempts>=Number.MAX_SAFE_INTEGER||typeof retry.nextAttemptAt!=='string')return null
 const timestamp=Date.parse(retry.nextAttemptAt)
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==retry.nextAttemptAt)return null
 return {version:1,attempts:retry.attempts,nextAttemptAt:retry.nextAttemptAt}
}

export function withoutClassificationRetry(data:Record<string,unknown>){const copy={...data};delete copy[classificationRetryKey];return copy}

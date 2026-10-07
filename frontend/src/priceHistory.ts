export type HistoryCondition='new'|'open-box'
export type HistoryPeriod='daily'|'monthly'
export type PriceObservation={id:number|string;item_id:string;store:string;observed_at:string;data:{status?:string;offers?:unknown}}
export type HistoryPoint={bucket:string;timestamp:number;cents:number;observedAt:string}
export type HistorySeries={store:string;condition:HistoryCondition;points:HistoryPoint[]}

const easternParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})

function easternDate(timestamp:number){
 const parts=Object.fromEntries(easternParts.formatToParts(timestamp).map(part=>[part.type,part.value]))
 return `${parts.year}-${parts.month}-${parts.day}`
}

function bucketTimestamp(bucket:string){
 const [year,month,day='01']=bucket.split('-').map(Number)
 return Date.UTC(year,month-1,Number(day))
}

export function aggregatePriceHistory(observations:PriceObservation[],period:HistoryPeriod):HistorySeries[]{
 const values=new Map<string,{store:string;condition:HistoryCondition;points:Map<string,HistoryPoint>}>()
 for(const observation of observations){
  if(typeof observation.observed_at!=='string'||typeof observation.store!=='string'||!observation.store.trim())continue
  const timestamp=Date.parse(observation.observed_at)
  if(!Number.isFinite(timestamp)||observation.data?.status!=='verified'||!Array.isArray(observation.data.offers))continue
  const date=easternDate(timestamp),bucket=period==='monthly'?date.slice(0,7):date
  for(const value of observation.data.offers){
   if(!value||typeof value!=='object')continue
   const offer=value as Record<string,unknown>,condition=offer.condition
   if((condition!=='new'&&condition!=='open-box')||offer.currency!=='USD'||!Number.isInteger(offer.cents)||(offer.cents as number)<=0)continue
   const seriesKey=`${observation.store}\u0000${condition}`,current=values.get(seriesKey)??{store:observation.store,condition,points:new Map<string,HistoryPoint>()}
   const point=current.points.get(bucket)
   if(!point||(offer.cents as number)<point.cents)current.points.set(bucket,{bucket,timestamp:bucketTimestamp(bucket),cents:offer.cents as number,observedAt:observation.observed_at})
   values.set(seriesKey,current)
  }
 }
 return [...values.values()].sort((a,b)=>a.store.localeCompare(b.store)||a.condition.localeCompare(b.condition)).map(series=>({...series,points:[...series.points.values()].sort((a,b)=>a.timestamp-b.timestamp)}))
}

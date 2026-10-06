import {describe,expect,it} from 'vitest'
import {aggregatePriceHistory,type PriceObservation} from './priceHistory'

const row=(id:number,observed_at:string,store:string,offers:unknown[],status='verified'):PriceObservation=>({id,item_id:'item',store,observed_at,data:{status,offers}})
const offer=(condition:'new'|'open-box',cents:number)=>({condition,cents,currency:'USD'})

describe('aggregatePriceHistory',()=>{
 it('uses Eastern daily boundaries and the lowest value in each bucket',()=>{
  const result=aggregatePriceHistory([
   row(1,'2026-03-08T04:30:00Z','dell',[offer('new',30000)]),
   row(2,'2026-03-08T05:30:00Z','dell',[offer('new',29000)]),
   row(3,'2026-03-08T18:00:00Z','dell',[offer('new',29500)]),
  ],'daily')
  expect(result[0].points.map(point=>[point.bucket,point.cents])).toEqual([['2026-03-07',30000],['2026-03-08',29000]])
 })

 it('uses Eastern monthly boundaries and leaves calendar gaps intact',()=>{
  const points=aggregatePriceHistory([
   row(1,'2026-03-01T04:30:00Z','dell',[offer('new',30000)]),
   row(2,'2026-05-01T04:30:00Z','dell',[offer('new',28000)]),
  ],'monthly')[0].points
  expect(points.map(point=>point.bucket)).toEqual(['2026-02','2026-05'])
  expect(points[1].timestamp-points[0].timestamp).toBe(Date.UTC(2026,4,1)-Date.UTC(2026,1,1))
 })

 it('rejects invalid and unverified observations',()=>{
  const result=aggregatePriceHistory([
   row(1,'bad date','dell',[offer('new',100)]),
   row(2,'2026-01-01T12:00:00Z','dell',[offer('new',100)],'unverified'),
   row(3,'2026-01-01T12:00:00Z','dell',[{condition:'new',cents:-1,currency:'USD'},{condition:'new',cents:100,currency:'EUR'}]),
  ],'daily')
  expect(result).toEqual([])
 })

 it('keeps retailer and condition series separate',()=>{
  const result=aggregatePriceHistory([
   row(1,'2026-01-02T12:00:00Z','bestbuy',[offer('new',30000),offer('open-box',25000)]),
   row(2,'2026-01-02T13:00:00Z','dell',[offer('new',29000)]),
  ],'daily')
  expect(result.map(series=>[series.store,series.condition,series.points[0].cents])).toEqual([
   ['bestbuy','new',30000],['bestbuy','open-box',25000],['dell','new',29000],
  ])
 })

 it('represents empty and single-point histories without inventing points',()=>{
  expect(aggregatePriceHistory([],'daily')).toEqual([])
  const result=aggregatePriceHistory([row(1,'2026-01-02T12:00:00Z','dell',[offer('new',29000)])],'daily')
  expect(result).toHaveLength(1)
  expect(result[0].points).toHaveLength(1)
 })
})

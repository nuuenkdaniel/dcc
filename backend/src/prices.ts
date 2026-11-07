import type {Pool} from 'pg'
import type {FastifyInstance} from 'fastify'
const id='xps14-2026-x7-oled-32-1tb'
const origins:Record<string,string>={bestbuy:'https://www.bestbuy.com',dell:'https://www.dell.com',microcenter:'https://www.microcenter.com'}
type PriceOffer={condition:string;cents:number;maxCents?:number;currency:string;eligible:boolean;availability:string;sku?:string}
type PriceResult={store:string;url:string;status:string;detail:string;offers:PriceOffer[]}
export function validatePriceResult(store:string,input:unknown):PriceResult{
 const data=input as Partial<PriceResult>,expected=origins[store]
 let url:URL;try{if(typeof data?.url!=='string'||data.url.length>4096)throw Error();url=new URL(data.url)}catch{throw Error('Invalid result')}
 if(!expected||data.store!==store||url.origin!==expected||url.protocol!=='https:'||url.username||url.password||!['verified','blocked','unverified','unmatched'].includes(String(data.status))||typeof data.detail!=='string'||data.detail.length>2000||!Array.isArray(data.offers)||data.offers.length>20)throw Error('Invalid result')
 for(const offer of data.offers){if(!offer||!Number.isInteger(offer.cents)||offer.cents<=0||offer.cents>10000000||offer.currency!=='USD'||!['new','open-box'].includes(offer.condition)||typeof offer.eligible!=='boolean'||typeof offer.availability!=='string'||offer.availability.length>1000||(offer.maxCents!==undefined&&(!Number.isInteger(offer.maxCents)||offer.maxCents<offer.cents||offer.maxCents>10000000))||(offer.sku!==undefined&&(typeof offer.sku!=='string'||offer.sku.length>200)))throw Error('Invalid result')}
 return data as PriceResult
}
export async function migratePrices(p:Pool){await p.query(`CREATE TABLE IF NOT EXISTS price_items(id text PRIMARY KEY,title text NOT NULL,target_cents integer NOT NULL,paused boolean NOT NULL DEFAULT false);CREATE TABLE IF NOT EXISTS price_sources(item_id text REFERENCES price_items(id),store text,last_attempt timestamptz,next_run timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'pending',detail text,last_good jsonb,PRIMARY KEY(item_id,store));CREATE TABLE IF NOT EXISTS price_observations(id bigserial PRIMARY KEY,item_id text REFERENCES price_items(id),store text,observed_at timestamptz NOT NULL DEFAULT now(),data jsonb NOT NULL);`);await p.query('INSERT INTO price_items(id,title,target_cents) VALUES($1,$2,280000) ON CONFLICT DO NOTHING',[id,'Dell XPS 14 (2026) · X7 358H · OLED touch · 32 GB · 1 TB']);for(const store of ['bestbuy','dell','microcenter'])await p.query('INSERT INTO price_sources(item_id,store) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,store])}
// Compatibility fence for an older caller/worker. Never query, schedule, mutate
// stored rows, call the curator, or activate a retailer/browser connector.
export async function checkPrices(_p:Pool){return {retired:true as const}}
export function priceRoutes(app:FastifyInstance){
 const retired=()=>({retired:true,error:'Price tracker has been retired. Stored data is preserved.'})
 app.get('/api/v1/prices/snapshot',async(_req,reply)=>reply.code(410).send(retired()))
 app.post('/api/v1/prices/settings',async(_req,reply)=>reply.code(410).send(retired()))
 app.post('/api/v1/prices/refresh',async(_req,reply)=>reply.code(410).send(retired()))
}

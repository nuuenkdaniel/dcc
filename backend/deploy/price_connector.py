"""Public price checks via a normal browser; never solves access challenges."""
import json, os, re, subprocess, threading
LOCK = threading.Lock()
URLS = {
 'bestbuy': 'https://www.bestbuy.com/product/dell-xps-14-3k-oled-touchscreen-laptop-intel-core-ultra-x7-series-3-358h-2026-32gb-memory-1tb-storage-copilot-pc-graphite/J3K4L6Q675',
 'dell': 'https://www.dell.com/en-us/shop/laptop-computers/spd/xps14da14260/da14260_reg_01',
 'microcenter': 'https://www.microcenter.com/search/search_results.aspx?Ntt=Dell%20XPS%2014',
}
def parse(store, text):
    base = {'store':store,'url':URLS[store],'offers':[]}
    if re.search(r'access denied|verify you are human|unusual traffic|captcha challenge', text, re.I):
        return {**base,'status':'blocked','detail':'Retailer access challenge. No bypass attempted.'}
    if store == 'bestbuy':
        title=text.split('Model:',1)[0]
        required=['358H','32GB','1TB','OLED','Touchscreen','2026']
        if '6686092' not in text or not all(x in title for x in required):
            return {**base,'status':'unverified','detail':'Exact SKU and configuration could not be verified.'}
        # Bound the price to the main product area, excluding accessories and protection plans.
        main=text.split('About this product',1)[-1].split('Protect your laptop',1)[0]
        match=re.search(r'\$([\d,]+\.\d{2})', main)
        if not match:return {**base,'status':'unverified','detail':'Main product price not found.'}
        price=round(float(match[1].replace(',',''))*100)
        if not 100000<=price<=1000000:return {**base,'status':'unverified','detail':'Unexpected price; manual review needed.'}
        shipping=bool(re.search(r'Shipping\s+Get it by',text))
        offers=[{'condition':'new','cents':price,'currency':'USD','eligible':shipping,'availability':'Shipping listed; delivery to your address must be confirmed' if shipping else 'Availability unverified','sku':'6686092'}]
        ob=re.search(r'Open-Box\s+\$([\d,]+\.\d{2})(?:\s*-\s*\$([\d,]+\.\d{2}))?',text)
        if ob:offers.append({'condition':'open-box','cents':round(float(ob[1].replace(',',''))*100),'maxCents':round(float((ob[2] or ob[1]).replace(',',''))*100),'currency':'USD','eligible':False,'availability':'Advertised range only. Condition and pickup within 10 miles of Stony Brook are unverified.','sku':'6686092'})
        return {**base,'status':'verified','detail':'Exact configuration verified. Before tax; shipping cost unknown. Local pickup is not verified.','offers':offers}
    if store=='dell':
        specs=text.rsplit('Tech Specs\nProcessor',1)[-1].split('Operating System Languages',1)[0]
        price=re.search(r'Dell Price\s+\$([\d,]+\.\d{2})',text)
        if 'Tech Specs\nProcessor' not in text or not all(t in specs for t in ['358H','32GB','1TB','OLED','Touch']) or 'Non-Touch' in specs or not price:
            return {**base,'status':'unverified','detail':'Exact selected configuration could not be verified. Base-model prices excluded.'}
        cents=round(float(price[1].replace(',',''))*100)
        if not 100000<=cents<=1000000:return {**base,'status':'unverified','detail':'Unexpected price; review required.'}
        return {**base,'status':'verified','detail':'X7 / OLED touch / 32 GB / 1 TB selected and verified. Configure these options again when opening Dell; URL may reset selections. Before tax.', 'offers':[{'condition':'new','cents':cents,'currency':'USD','eligible':'Get it as soon as' in text,'availability':'Shipping listed; confirm delivery to your address. Free Shipping advertised.','sku':'da14260_reg_01'}]}
    if '358H' in text and 'DA14260' in text:
        return {**base,'status':'unverified','detail':'Possible matching listing found. Exact configuration and store eligibility need review before recording a price.'}
    return {**base,'status':'unmatched','detail':'No verified matching DA14260 / X7 OLED listing. Older DA14250 models excluded. Local inventory within 10 miles of Stony Brook is not verified.'}
def dispatch(data):
    store=data.get('store')
    if store not in URLS:raise ValueError('Unsupported source')
    if not LOCK.acquire(blocking=False):raise ValueError('Price browser busy')
    try:
        # Only static allowlisted retailer URLs enter the browser. No arbitrary URL or JS input.
        setup = ''
        if store=='dell':
            setup = """import time
for option in ['J0CF8P-4X26RD','TJD2R4-M43455','MTPMGW-7F1W9D']:
 selector='[data-option-id="'+option+'"]'
 for attempt in range(12):
  if js('!!document.querySelector('+json.dumps(selector)+')'):break
  time.sleep(.5)
 if not js('!!document.querySelector('+json.dumps(selector)+')'):raise ValueError('Configuration option missing')
 if not js('document.querySelector('+json.dumps(selector)+').getAttribute("aria-pressed")==="true"'):
  js('document.querySelector('+json.dumps(selector)+').click()')
  for attempt in range(20):
   time.sleep(.5)
   js('(()=>{const e=document.querySelector("#selection-modal-change-btn");if(e && e.getBoundingClientRect().width>0)e.click()})()')
   if js('document.querySelector('+json.dumps(selector)+')?.getAttribute("aria-pressed")==="true"'):break
  else:raise ValueError('Configuration did not update')
time.sleep(1)
"""
        code='import json\ntid=new_tab('+repr(URLS[store])+')\ntry:\n wait_for_load()\n'+''.join(' '+l+'\n' for l in setup.splitlines())+' print("DAYMARK_RESULT="+json.dumps(js("document.body.innerText")))\nfinally:\n cdp("Target.closeTarget",targetId=tid)\n'
        result=subprocess.run(['/root/.local/share/uv/tools/browser-use/bin/browser-use'],input=code,text=True,capture_output=True,timeout=65,env={**os.environ,'BU_NAME':'daymark-prices','BU_CDP_URL':'http://127.0.0.1:9222','BH_RECORD':'0','BH_DOMAIN_SKILLS':'0'},cwd='/root/.local/share/daymark')
        line=next((l for l in result.stdout.splitlines() if l.startswith('DAYMARK_RESULT=')),None)
        if not line:raise ValueError('Browser unavailable or retailer did not load')
        return parse(store,json.loads(line.split('=',1)[1]))
    finally:LOCK.release()

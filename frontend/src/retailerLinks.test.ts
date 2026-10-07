import {expect,it} from 'vitest'
import {safeRetailerUrl} from './retailerLinks'

it('allows only the expected HTTPS retailer origin',()=>{
 expect(safeRetailerUrl('bestbuy','https://www.bestbuy.com/product/example')).toBe('https://www.bestbuy.com/product/example')
 expect(safeRetailerUrl('bestbuy','javascript:alert(1)')).toBeNull()
 expect(safeRetailerUrl('bestbuy','https://evil.invalid/product')).toBeNull()
 expect(safeRetailerUrl('dell','http://www.dell.com/product')).toBeNull()
 expect(safeRetailerUrl('dell','https://www.dell.com/'+ 'x'.repeat(5000))).toBeNull()
})

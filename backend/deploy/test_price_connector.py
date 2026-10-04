import unittest
from price_connector import parse
class PriceTests(unittest.TestCase):
 def test_exact_price_excludes_accessories(self):
  text='2026 358H 32GB 1TB OLED Touchscreen Model: SKU 6686092 About this product $2,799.99 Protect your laptop $39.99 Shipping Get it by Tuesday Open-Box $2,699.99 - $2,799.99'
  r=parse('bestbuy',text);self.assertEqual(r['offers'][0]['cents'],279999);self.assertTrue(r['offers'][0]['eligible']);self.assertFalse(r['offers'][1]['eligible'])
 def test_wrong_variant_rejected(self):self.assertEqual(parse('bestbuy','2025 255H 32GB OLED $999.99')['status'],'unverified')
 def test_block_preserves_no_price(self):self.assertEqual(parse('bestbuy','Access Denied')['offers'],[])
 def test_dell_selected_configuration(self):
  text='Dell Price $3,149.99 Get it as soon as Thursday Tech Specs\nProcessor\n358H\nOLED Touch\nMemory\n32GB\nStorage\n1TB\nOperating System Languages'
  self.assertEqual(parse('dell',text)['offers'][0]['cents'],314999)
 def test_dell_base_not_qualifying(self):self.assertEqual(parse('dell','32 GB 1 TB FHD $2,619.99')['offers'],[])
if __name__=='__main__':unittest.main()

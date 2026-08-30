import unittest

from PIL import ImageChops

from niimbot_printer import create_contact_label


class NiimbotContactLabelTest(unittest.TestCase):
    def test_shipping_contact_has_no_frame_and_keeps_phone_above_feed_margin(self):
        portrait = create_contact_label(
            num="A01",
            item_name="대구 크레용 본점",
            winner_name="김미옥",
            sold_price="",
            winner_phone="01012345678",
        )
        landscape = portrait.rotate(-90, expand=True).convert("L")
        ink = ImageChops.invert(landscape).getbbox()
        self.assertIsNotNone(ink)
        self.assertLessEqual(ink[3], landscape.height - 18)
        self.assertTrue(all(pixel == 255 for pixel in landscape.crop((0, 0, landscape.width, 2)).getdata()))
        self.assertTrue(all(pixel == 255 for pixel in landscape.crop((0, landscape.height - 2, landscape.width, landscape.height)).getdata()))


if __name__ == "__main__":
    unittest.main()

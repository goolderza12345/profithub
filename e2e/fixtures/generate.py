"""
สร้างไฟล์ทดสอบการนำเข้า (ข้อมูลสมมติทั้งหมด ไม่ใช่รูปแบบไฟล์จริงของแพลตฟอร์มใด)
รัน: python3 e2e/fixtures/generate.py   (ต้องมี openpyxl)
"""
import datetime
import os

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))


def path(name):
    return os.path.join(HERE, name)


# 1) Excel ภาษาไทย หัวตารางไม่ใช่แม่แบบ มีแถวชื่อรายงานด้านบน และค่าส่งของทั้งคำสั่งซื้อที่ซ้ำทุกบรรทัด
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "ยอดขาย"
ws.append(["รายงานคำสั่งซื้อ ร้านตัวอย่าง (ข้อมูลทดสอบ)"])
ws.append([])
ws.append(["หมายเลขคำสั่งซื้อ", "วันที่สร้างคำสั่งซื้อ", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อชิ้น",
           "ค่าส่งของคำสั่งซื้อ", "ค่าคอมมิชชั่น", "ค่าบริการ"])
d = datetime.datetime
ws.append(["TH-0001", d(2026, 11, 5, 14, 30), "TS-001", "เสื้อยืดสีขาว", 2, 199, 40, 20, 5])
ws.append(["TH-0001", d(2026, 11, 5, 14, 30), "MUG-002", "แก้วมัค", 1, 250, 40, 12, 3])
ws.append(["TH-0002", d(2026, 11, 6, 9, 0), "TS-001", "เสื้อยืดสีขาว", 1, 199, 30, 10, 2])
ws.append(["TH-0003", d(2026, 11, 7, 10, 0), "GIFT-9", "พวงกุญแจ", 1, 59, 25, 3, 1])
ws.append(["TH-0004", d(2026, 11, 7, 11, 0), "TS-001", "เสื้อยืดสีขาว", 0, 199, 30, 10, 2])
ws.append([261105123456789012, d(2026, 11, 8, 8, 0), "TS-001", "เสื้อยืดสีขาว", 1, 199, 30, 10, 2])
wb.create_sheet("หมายเหตุ").append(["ชีตนี้ไม่ใช่ข้อมูลยอดขาย"])
wb.save(path("thai-orders.xlsx"))

# 2) CSV แม่แบบ หัวคอลัมน์ภาษาไทย UTF-8 BOM มีตัวเลขที่มีคอมมา และแถวซ้ำในไฟล์
thai_csv = "\n".join([
    "เลขคำสั่งซื้อ,วันที่สั่งซื้อ,ช่องทางขาย,SKU,จำนวนชิ้น,ราคาขายต่อชิ้น,ส่วนลด,เงินคืน,ชิ้นที่ได้รับคืน,ค่าธรรมเนียมแพลตฟอร์ม,ค่าขนส่งที่ร้านออก",
    'CSV-1,01/11/2569,Shopee,TS-001,2,"1,199.00",20,0,0,23.88,0',
    "CSV-2,2026-11-02,Lazada,MUG-002,1,250,0,0,0,15,15",
    "CSV-2,2026-11-02,lazada,mug-002,1,250,0,0,0,15,15",
    "CSV-3,2026-13-40,Shopee,TS-001,1,199,0,0,0,0,0",
])
with open(path("template-thai.csv"), "w", encoding="utf-8-sig", newline="") as f:
    f.write(thai_csv + "\n")

# 3) CSV ภาษาไทยแบบ Windows-874 (Excel รุ่นเก่า)
with open(path("thai-cp874.csv"), "wb") as f:
    f.write(("เลขคำสั่งซื้อ,วันที่สั่งซื้อ,ช่องทางขาย,SKU,จำนวนชิ้น,ราคาขายต่อชิ้น\n"
             "CP-1,2026-11-03,TikTok Shop,TS-001,1,199\n").encode("cp874"))

# 4) UTF-16LE คั่นด้วย Tab (Excel "Unicode Text")
with open(path("thai-utf16.csv"), "wb") as f:
    f.write(b"\xff\xfe" + ("order_id\torder_date\tchannel\tsku\tquantity\tunit_price\n"
                           "U16-1\t2026-11-04\tLINE\tMUG-002\t1\t250\n").encode("utf-16-le"))

# 5) ไฟล์ว่าง: มีแต่หัวตาราง / 0 ไบต์
with open(path("header-only.csv"), "w", encoding="utf-8") as f:
    f.write("order_id,order_date,channel,sku,quantity,unit_price\n")
open(path("zero-bytes.csv"), "wb").close()

# 6) ข้อมูลผิดรูปแบบ
with open(path("malformed.csv"), "w", encoding="utf-8") as f:
    f.write("order_id,order_date,channel,sku,quantity,unit_price,discount\n"
            "BAD-1,not-a-date,Shopee,TS-001,abc,199,0\n"
            "BAD-2,2026-11-01,Shopee,TS 001,1,-5,0\n"
            "BAD-3,2026-11-01,Shopee,TS-001,1,100,500\n"
            "GOOD-1,2026-11-01,Shopee,TS-001,1,100,10\n")

# 7) Excel รุ่นเก่า (.xls) — ใช้ทดสอบการปฏิเสธเท่านั้น (มีแค่ส่วนหัวของไฟล์)
with open(path("legacy.xls"), "wb") as f:
    f.write(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b"\x00" * 504)

print("fixtures written to", HERE)

# 8) Phase 3: คำสั่งซื้อที่มีสถานะ — นำเข้ารอบแรก / รอบอัปเดต (คืนเงิน) / ไฟล์เก่า / สถานะที่ระบบไม่รู้จัก
ORDER_HEAD = "order_id,order_date,channel,sku,quantity,unit_price,discount,refund,returned_qty,platform_fee,shipping_fee,order_status,not_returned_qty,fee_refunded"
def write_orders(name, lines):
    with open(path(name), "w", encoding="utf-8", newline="") as f:
        f.write("\n".join([ORDER_HEAD] + lines) + "\n")

write_orders("orders-v1-shipped.csv", [
    "ORD-1,2026-11-10,Shopee,TS-001,2,199,20,0,0,23.88,0,shipped,0,0",
    "ORD-2,2026-11-11,Shopee,MUG-002,1,250,0,0,0,15,0,shipped,0,0",
])
write_orders("orders-v2-completed-refund.csv", [
    "ORD-1,2026-11-10,Shopee,TS-001,2,199,20,100,0,23.88,0,completed,1,5",
    "ORD-2,2026-11-11,Shopee,MUG-002,1,250,0,0,0,15,0,completed,0,0",
])
with open(path("orders-unknown-status.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("order_id,order_date,channel,sku,quantity,unit_price,order_status\n"
            "UNK-1,2026-11-12,Shopee,TS-001,1,199,To Ship\n"
            "UNK-2,2026-11-12,Shopee,TS-001,1,199,Unpaid\n")

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * E2E: ขั้นตอนนำเข้าแบบ Smart Import บนหน้าจอมือถือ
 * แต่ละ test เริ่มจากเบราว์เซอร์ใหม่ (IndexedDB ว่าง)
 * ไฟล์ทดสอบเป็นข้อมูลสมมติ สร้างจาก e2e/fixtures/generate.py
 */
const FX = (name: string) => path.join(__dirname, "fixtures", name);

async function addProduct(page: Page, sku: string, name: string, cost: number) {
  await page.getByRole("button", { name: /เพิ่มสินค้า/ }).first().click();
  await page.getByPlaceholder("เช่น TS-001").fill(sku);
  await page.getByPlaceholder("เช่น เสื้อยืดคอตตอน สีขาว").fill(name);
  await page.getByPlaceholder("0.00").fill(String(cost));
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

async function seedProducts(page: Page) {
  await page.goto("/products");
  await addProduct(page, "TS-001", "เสื้อยืดขาว", 85);
  await addProduct(page, "MUG-002", "แก้วมัค", 95);
}

async function upload(page: Page, file: string) {
  await page.goto("/import");
  await expect(page.getByText("แหล่งข้อมูลของไฟล์")).toBeVisible();
  await page.setInputFiles("#import-file", FX(file));
}

async function counts(page: Page, testId = "import-counts"): Promise<Record<string, number>> {
  const box = page.getByTestId(testId);
  await expect(box).toBeVisible();
  const out: Record<string, number> = {};
  for (const item of await box.locator("div").all()) {
    out[(await item.locator("dt").innerText()).trim()] = Number((await item.locator("dd").innerText()).replace(/,/g, ""));
  }
  return out;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const field = (page: Page, key: string) => page.locator(`li[data-field="${key}"]`);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => {
    throw e;
  });
});

test("Excel ภาษาไทย: จับคู่คอลัมน์เอง ค่าส่งระดับคำสั่งซื้อ จับคู่สินค้าใหม่ นำเข้า และสรุปผล", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "thai-orders.xlsx");

  // ขั้นจับคู่คอลัมน์: พบหัวตารางใต้แถวชื่อรายงาน
  await expect(page.getByText("จับคู่คอลัมน์").first()).toBeVisible();
  await expect(page.getByLabel("แถวหัวตาราง")).toHaveValue("1");
  await expect(page.getByLabel("คอลัมน์สำหรับ เลขคำสั่งซื้อ")).toHaveValue("0");
  await noHorizontalOverflow(page);

  const review = page.getByRole("button", { name: "ตรวจสอบข้อมูล" });
  await expect(review).toBeDisabled(); // ยังไม่ได้เลือกช่องทาง
  await page.getByLabel("ช่องทางเดียวสำหรับทั้งไฟล์").selectOption("Shopee");
  await page.getByLabel("คอลัมน์สำหรับ ค่าขนส่งที่ร้านออก").selectOption("6");
  await field(page, "shippingFee").getByRole("button", { name: "ทั้งคำสั่งซื้อ (ซ้ำทุกบรรทัด)" }).click();
  await page.getByLabel("คอลัมน์สำหรับ ค่าธรรมเนียมแพลตฟอร์ม").selectOption("7");
  // v1.3: “ค่าบริการ” จับคู่กับช่องค่าบริการให้อัตโนมัติ (ข้อมูลเพิ่มเติม) — ไม่ต้องรวมเข้าค่าธรรมเนียมเอง
  await expect(page.getByLabel("คอลัมน์สำหรับ ค่าบริการ")).toHaveValue("8");
  await expect(review).toBeEnabled();
  await review.click();

  // ขั้นตรวจสอบ
  expect(await counts(page)).toEqual({ ทั้งหมด: 6, นำเข้าได้: 3, ผิดพลาด: 2, ซ้ำ: 0, รอจับคู่: 1 });
  await expect(page.locator('[data-row="8"]')).toContainText("จำนวนชิ้นต้องมากกว่า 0");
  await expect(page.locator('[data-row="9"]')).toContainText("ตัวเลขแบบย่อ");
  await expect(page.getByText("ไฟล์ไม่มีข้อมูล:").first()).toBeVisible();
  await noHorizontalOverflow(page);

  // จับคู่ SKU ใหม่: ต้องเลือกเองเท่านั้น
  const gift = page.locator('li[data-sku="GIFT-9"]');
  await expect(gift).toContainText("รอจับคู่");
  await page.getByLabel("จับคู่ SKU GIFT-9").selectOption("new");
  await gift.getByLabel("ต้นทุนต่อชิ้น (บาท)").fill("15");
  await expect(gift).toContainText("จับคู่แล้ว");
  expect(await counts(page)).toMatchObject({ นำเข้าได้: 4, รอจับคู่: 0 });

  // v1.3: 4 แถวที่นำเข้าได้ = 3 คำสั่งซื้อใหม่ (TH-0001 มี 2 บรรทัด)
  expect(await counts(page, "plan-counts")).toMatchObject({ ใหม่: 3, ไม่เปลี่ยน: 0 });

  // ยืนยันก่อนบันทึก
  await page.getByRole("button", { name: "บันทึก 3 คำสั่งซื้อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการบันทึก" });
  await expect(dialog).toContainText("สร้างสินค้าใหม่ 1 รายการ: GIFT-9");
  await dialog.getByRole("button", { name: "บันทึก 3 คำสั่งซื้อ" }).click();

  // หน้าสรุปผล
  const summary = page.getByTestId("import-summary");
  await expect(summary).toContainText("คำสั่งซื้อใหม่");
  await expect(summary.locator("div").first().locator("dd")).toHaveText("3");
  await expect(page.getByText("รายการขาย: เพิ่ม 4")).toBeVisible();
  await expect(page.getByText("สร้างสินค้าใหม่ 1 รายการ")).toBeVisible();
  await expect(page.getByText("สร้างจุดกู้คืนก่อนบันทึกแล้ว")).toBeVisible();
  await noHorizontalOverflow(page);

  // Dashboard: กำไรโดยประมาณ ค่าส่งหักครั้งเดียว (95 ไม่ใช่ 135)
  // 906 − ต้นทุน 365 − ค่าธรรมเนียม 56 − ค่าส่ง 95 = 390
  await page.goto("/");
  await expect(page.getByText("กำไรสุทธิ (โดยประมาณ)")).toBeVisible();
  await expect(page.getByTestId("estimate-notice")).toBeVisible();
  await expect(page.locator("main")).toContainText("฿390.00");

  // แก้ต้นทุนภายหลัง: กำไรของคำสั่งซื้อเดิมไม่เปลี่ยน
  await page.goto("/products");
  await page.locator("div.md\\:hidden > div").filter({ hasText: "เสื้อยืดขาว" }).getByRole("button", { name: "แก้ไข" }).click();
  await page.getByPlaceholder("0.00").fill("150");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("฿150.00").first()).toBeVisible();
  await page.goto("/");
  await expect(page.locator("main")).toContainText("฿390.00");

  // จุดกู้คืนจากระบบ Backup/Restore เดิม
  await page.goto("/settings");
  await expect(page.getByText('ก่อนนำเข้า "thai-orders.xlsx"')).toBeVisible();

  // นำเข้าไฟล์เดิมซ้ำ: ไม่มีรายการใหม่
  await upload(page, "thai-orders.xlsx");
  await expect(page.getByLabel("ช่องทางเดียวสำหรับทั้งไฟล์")).toHaveValue("Shopee"); // จำการจับคู่ครั้งก่อน
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  await expect(page.getByText("ไฟล์นี้เคยนำเข้าแล้วเมื่อ")).toBeVisible();
  // v1.3: แถวยังตรวจผ่าน แต่ทุกคำสั่งซื้อ "ไม่เปลี่ยน" จึงไม่มีอะไรถูกบันทึก
  expect(await counts(page)).toEqual({ ทั้งหมด: 6, นำเข้าได้: 4, ผิดพลาด: 2, ซ้ำ: 0, รอจับคู่: 0 });
  expect(await counts(page, "plan-counts")).toMatchObject({ ใหม่: 0, ไม่เปลี่ยน: 3, อัปเดต: 0 });
  await expect(page.getByRole("button", { name: "บันทึก 0 คำสั่งซื้อ" })).toBeDisabled();
});

test("CSV แม่แบบหัวคอลัมน์ไทย: จับคู่อัตโนมัติ แถวซ้ำในไฟล์ และวันที่ผิด", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "template-thai.csv");
  await expect(page.getByText("จับคู่คอลัมน์ได้ตรงกับรูปแบบที่รู้จัก")).toBeVisible();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page)).toEqual({ ทั้งหมด: 4, นำเข้าได้: 2, ผิดพลาด: 1, ซ้ำ: 1, รอจับคู่: 0 });
  await expect(page.locator('[data-row="4"]')).toContainText("ซ้ำกับแถว 3");
  await expect(page.locator('[data-row="5"]')).toContainText('วันที่ไม่ถูกต้อง "2026-13-40"');
  await page.getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการบันทึก" }).getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await expect(page.getByTestId("import-summary").locator("div").first().locator("dd")).toHaveText("2");
  await expect(page.getByRole("button", { name: /ดาวน์โหลดรายการที่ไม่ได้นำเข้า/ })).toBeVisible();
});

test("แพลตฟอร์มที่ยังไม่ยืนยันรูปแบบไฟล์: แจ้งเตือน และต้องยืนยันการจับคู่เอง", async ({ page }) => {
  await seedProducts(page);
  await page.goto("/import");
  await page.getByRole("radio", { name: /Shopee/ }).click();
  await expect(page.getByText("ยังไม่มีรูปแบบไฟล์ Shopee ที่ผ่านการตรวจสอบกับไฟล์จริง")).toBeVisible();
  await page.setInputFiles("#import-file", FX("template-thai.csv"));
  await expect(page.getByText("Shopee (ทั้งไฟล์)")).toBeVisible();
  const review = page.getByRole("button", { name: "ตรวจสอบข้อมูล" });
  await expect(review).toBeDisabled();
  await page.getByText("ฉันตรวจสอบแล้วว่าแต่ละช่องตรงกับคอลัมน์ที่ถูกต้อง").click();
  await expect(review).toBeEnabled();
  await review.click();
  expect((await counts(page)).ทั้งหมด).toBe(4);
});

test("ไฟล์ว่าง ไฟล์ 0 ไบต์ ไฟล์ .xls และข้อมูลผิดรูปแบบ", async ({ page }) => {
  await seedProducts(page);

  await upload(page, "zero-bytes.csv");
  await expect(page.locator("main").getByRole("alert")).toHaveText("ไฟล์ว่างเปล่า (0 ไบต์)");

  await page.setInputFiles("#import-file", FX("legacy.xls"));
  await expect(page.locator("main").getByRole("alert")).toContainText("ไม่รองรับไฟล์ Excel รุ่นเก่า (.xls)");

  await page.setInputFiles("#import-file", FX("header-only.csv"));
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("ไฟล์ไม่มีข้อมูล");

  await upload(page, "malformed.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page)).toEqual({ ทั้งหมด: 4, นำเข้าได้: 1, ผิดพลาด: 3, ซ้ำ: 0, รอจับคู่: 0 });
  const row2 = page.locator('[data-row="2"]');
  await expect(row2).toContainText('วันที่ไม่ถูกต้อง "not-a-date"');
  await expect(row2).toContainText('จำนวนชิ้นไม่ใช่ตัวเลข "abc"');
  await expect(page.locator('[data-row="3"]')).toContainText("SKU ห้ามมีช่องว่าง");
  await expect(page.locator('[data-row="3"]')).toContainText("ราคาขายต่อชิ้นต้องไม่ติดลบ");
  await expect(page.locator('[data-row="4"]')).toContainText("ส่วนลดมากกว่ายอดขายของบรรทัด");
  await expect(page.locator('[data-row="5"]')).toHaveAttribute("data-status", "ok");
});

test("ไฟล์ภาษาไทย Windows-874 และ UTF-16", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "thai-cp874.csv");
  await expect(page.getByText(/Windows-874/)).toBeVisible();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect((await counts(page)).นำเข้าได้).toBe(1);

  await upload(page, "thai-utf16.csv");
  await expect(page.getByText(/UTF-16LE/)).toBeVisible();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect((await counts(page)).นำเข้าได้).toBe(1);
});

test("คำสั่งซื้อ: สถานะ → อัปเดต/คืนเงินหลังนำเข้า → ประวัติ → ไฟล์เก่าไม่ทับ", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "orders-v1-shipped.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page, "plan-counts")).toMatchObject({ ใหม่: 2 });
  await page.getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการบันทึก" }).getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await expect(page.getByTestId("import-summary")).toBeVisible();

  // จัดส่งแล้วแต่ยังไม่สำเร็จ → กำไรโดยประมาณ
  await page.goto("/");
  await expect(page.getByText("กำไรสุทธิ (โดยประมาณ)")).toBeVisible();
  await expect(page.getByTestId("order-notice")).toContainText("คำสั่งซื้อยังไม่สำเร็จ");

  // แก้ต้นทุนก่อนนำเข้ารอบอัปเดต: ต้นทุนของคำสั่งซื้อเดิมต้องไม่เปลี่ยน
  await page.goto("/products");
  await page.locator("div.md\\:hidden > div").filter({ hasText: "เสื้อยืดขาว" }).getByRole("button", { name: "แก้ไข" }).click();
  await page.getByPlaceholder("0.00").fill("150");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("฿150.00").first()).toBeVisible();

  // รอบอัปเดต: สำเร็จ + คืนเงิน 100 ไม่ต้องส่งคืน 1 ชิ้น + ได้ค่าธรรมเนียมคืน 5
  await upload(page, "orders-v2-completed-refund.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page, "plan-counts")).toMatchObject({ ใหม่: 0, อัปเดต: 2 });
  const ord1 = page.locator('[data-order="ORD-1"]');
  await expect(ord1).toContainText("เงินคืนที่ร้านรับภาระ: 0 → 100");
  await expect(ord1).toContainText("สถานะ: จัดส่งแล้ว → สำเร็จ");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath("review-plan.png"), fullPage: true });
  await page.getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการบันทึก" }).getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await expect(page.getByTestId("import-summary").locator("div").nth(1).locator("dd")).toHaveText("2");

  // กำไร = ORD-1 (378 − 100 − 170 − 18.88 = 89.12) + ORD-2 (250 − 95 − 15 = 140) = 229.12 (ต้นทุนเดิม 85 ไม่ใช่ 150)
  await page.goto("/");
  await expect(page.locator("main")).toContainText("฿229.12");
  await expect(page.getByText("กำไรสุทธิ", { exact: true }).first()).toBeVisible();

  // ประวัติ
  await page.goto("/orders");
  await page.locator('button[data-order="ORD-1"]').click();
  await expect(page.getByTestId("order-history").locator(":scope > li")).toHaveCount(2);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath("orders-detail.png"), fullPage: true });
  await expect(page.getByTestId("order-history")).toContainText("เงินคืนที่ร้านรับภาระ: 0 → 100");
  await page.getByRole("button", { name: "ปิด" }).click();

  // ไฟล์เก่า (จัดส่งแล้ว) ไม่บันทึกทับข้อมูลที่สำเร็จแล้ว
  await upload(page, "orders-v1-shipped.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page, "plan-counts")).toMatchObject({ "ข้อมูลเก่ากว่า": 2 });
  await expect(page.getByRole("button", { name: "บันทึก 0 คำสั่งซื้อ" })).toBeDisabled();
});

test("สถานะที่ระบบไม่รู้จัก ต้องจับคู่เองก่อนนำเข้า", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "orders-unknown-status.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page)).toMatchObject({ นำเข้าได้: 0, รอจับคู่: 2 });
  await page.getByLabel("จับคู่สถานะ To Ship").selectOption("processing");
  await page.getByLabel("จับคู่สถานะ Unpaid").selectOption("pending_payment");
  expect(await counts(page)).toMatchObject({ นำเข้าได้: 2, รอจับคู่: 0 });
  await page.getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการบันทึก" }).getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await page.goto("/");
  // รอชำระไม่นับในกำไร: ยอดขายสุทธิเท่ากับ 1 คำสั่งซื้อ
  await expect(page.getByTestId("order-notice")).toContainText("รอชำระ 1");
  await expect(page.locator("main")).toContainText("฿199.00");
});

test("รายงานการเงิน: แทนค่าธรรมเนียม ไม่นับซ้ำ แทนค่าใช้จ่ายที่กรอกเอง และกระทบยอดโอน", async ({ page }) => {
  await seedProducts(page);
  // ค่าใช้จ่ายที่กรอกเอง (ซ้ำกับค่าบริการรายเดือนในรายงาน)
  await page.goto("/expenses");
  await page.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }).first().click();
  await page.locator('[role=dialog] input[type=date]').fill("2026-11-16");
  await page.getByPlaceholder("0.00").fill("99");
  await page.locator("[role=dialog] select").first().selectOption("platform_fee");
  await page.locator("[role=dialog] select").nth(1).selectOption("Shopee");
  await page.getByPlaceholder("เช่น Shopee Ads สัปดาห์ที่ 1").fill("ค่าบริการกรอกเอง");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("ค่าบริการกรอกเอง")).toBeVisible();

  await upload(page, "orders-v2-completed-refund.csv");
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  await page.getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการบันทึก" }).getByRole("button", { name: "บันทึก 2 คำสั่งซื้อ" }).click();
  await expect(page.getByTestId("import-summary")).toBeVisible();

  const importSettlement = async (file: string) => {
    await page.goto("/import");
    await page.getByRole("button", { name: "รายงานการเงิน" }).click();
    await page.getByLabel("ช่องทางของรายงาน").selectOption("Shopee");
    await page.setInputFiles("#settlement-file", FX(file));
    await page.getByRole("button", { name: "ตรวจสอบรายงาน" }).click();
  };

  await importSettlement("settlement-r1.csv");
  expect(await counts(page, "settlement-counts")).toMatchObject({ รายการใหม่: 7 });
  await page.getByLabel(/ค่าบริการกรอกเอง/).check();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "บันทึกรายงาน" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "บันทึกรายงาน" }).click();
  await expect(page.getByTestId("settlement-summary")).toContainText("คำนวณค่าธรรมเนียมใหม่ 2 คำสั่งซื้อ");

  // ORD-1 = 378 − 100 − 170 − (23 − 5) = 90 · ORD-2 = 250 − 95 − 14 = 141 · ค่าบริการ 99 นับครั้งเดียว → 132
  await page.goto("/");
  await expect(page.locator("main")).toContainText("฿132.00");

  // รายงานเดิมซ้ำ → บันทึกไม่ได้
  await importSettlement("settlement-r1.csv");
  await expect(page.getByText("ไฟล์นี้เคยนำเข้าแล้ว — บันทึกซ้ำไม่ได้")).toBeVisible();
  await expect(page.getByRole("button", { name: "บันทึกรายงาน" })).toBeDisabled();

  // รายงานช่วงเวลาซ้อนกัน: ORD-2 ไม่นับซ้ำ มีเพียงค่าคอมมิชชันปรับเพิ่มของ ORD-1
  await importSettlement("settlement-r2-overlap.csv");
  expect(await counts(page, "settlement-counts")).toMatchObject({ รายการใหม่: 1, "มีอยู่แล้ว (ไม่นับซ้ำ)": 3 });
  await page.getByRole("button", { name: "บันทึกรายงาน" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "บันทึกรายงาน" }).click();
  await expect(page.getByTestId("settlement-summary")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("main")).toContainText("฿130.50");

  // กระทบยอดโอน: ORD-1 คาดไว้ 258.50 แต่รายงานแจ้ง 255
  await page.goto("/orders");
  await page.getByRole("button", { name: /ยอดโอนไม่ตรง 1/ }).click();
  await page.locator('button[data-order="ORD-1"]').click();
  await expect(page.getByTestId("payout-mismatch")).toContainText("ต่าง");
  await noHorizontalOverflow(page);
  await expect(page.getByTestId("order-history")).toContainText("รายงานการเงิน");

  // ค่าใช้จ่ายที่กรอกเองถูกแทน (ไม่ลบ)
  await page.goto("/expenses");
  await expect(page.getByText("ใช้รายงานการเงินแทน (ไม่นับ)")).toBeVisible();
  await expect(page.getByText("จากรายงานการเงิน")).toBeVisible();
});

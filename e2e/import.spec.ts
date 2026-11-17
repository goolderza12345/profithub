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

async function counts(page: Page): Promise<Record<string, number>> {
  const box = page.getByTestId("import-counts");
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
  await field(page, "platformFee").getByRole("button", { name: "รวมอีกคอลัมน์" }).click();
  await page.getByLabel("คอลัมน์สำหรับ ค่าธรรมเนียมแพลตฟอร์ม (2)").selectOption("8");
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

  // ยืนยันก่อนบันทึก
  await page.getByRole("button", { name: "นำเข้า 4 รายการ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการนำเข้า" });
  await expect(dialog).toContainText("สร้างสินค้าใหม่ 1 รายการ: GIFT-9");
  await dialog.getByRole("button", { name: "นำเข้า 4 รายการ" }).click();

  // หน้าสรุปผล
  const summary = page.getByTestId("import-summary");
  await expect(summary).toContainText("นำเข้าแล้ว");
  await expect(summary.locator("div").first().locator("dd")).toHaveText("4");
  await expect(page.getByText("สร้างสินค้าใหม่ 1 รายการ")).toBeVisible();
  await expect(page.getByText("สร้างจุดกู้คืนก่อนนำเข้าแล้ว")).toBeVisible();
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
  expect(await counts(page)).toEqual({ ทั้งหมด: 6, นำเข้าได้: 0, ผิดพลาด: 2, ซ้ำ: 4, รอจับคู่: 0 });
  await expect(page.getByRole("button", { name: "นำเข้า 0 รายการ" })).toBeDisabled();
});

test("CSV แม่แบบหัวคอลัมน์ไทย: จับคู่อัตโนมัติ แถวซ้ำในไฟล์ และวันที่ผิด", async ({ page }) => {
  await seedProducts(page);
  await upload(page, "template-thai.csv");
  await expect(page.getByText("จับคู่คอลัมน์ได้ตรงกับรูปแบบที่รู้จัก")).toBeVisible();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูล" }).click();
  expect(await counts(page)).toEqual({ ทั้งหมด: 4, นำเข้าได้: 2, ผิดพลาด: 1, ซ้ำ: 1, รอจับคู่: 0 });
  await expect(page.locator('[data-row="4"]')).toContainText("ซ้ำกับแถว 3");
  await expect(page.locator('[data-row="5"]')).toContainText('วันที่ไม่ถูกต้อง "2026-13-40"');
  await page.getByRole("button", { name: "นำเข้า 2 รายการ" }).click();
  await page.getByRole("dialog", { name: "ยืนยันการนำเข้า" }).getByRole("button", { name: "นำเข้า 2 รายการ" }).click();
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

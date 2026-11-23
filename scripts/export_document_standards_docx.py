"""Build Supthavee_ERP_Document_Standards.md from the extracted baseline, then a .docx.

Uses only the Python standard library. Does not touch app/ or lib/.
"""

from __future__ import annotations

import html
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "_tmp_docstd.txt"
MARKDOWN = ROOT / "Supthavee_ERP_Document_Standards.md"
DOCX = ROOT / "Supthavee_ERP_Document_Standards.docx"


def build_markdown() -> str:
    text = BASELINE.read_text(encoding="utf-8").lstrip()
    text = text.replace(
        "Supthavee ERP - Document Standards (มาตรฐานเอกสารอ้างอิงตาม GAAP/TFRS - อัปเดต Phase 23-24)",
        "# Supthavee ERP — Document Standards\n\nมาตรฐานเอกสารอ้างอิงตาม GAAP/TFRS อัปเดต Phase 31.2 (พฤศจิกายน 2026)",
    )
    old_ap = (
        "AP_WRITEOFF (PWO - Purchase Write-off - ใบสำคัญตัดหนี้): "
        "บันทึกการตัดยอดเจ้าหนี้ (เช่น ซัพพลายเออร์ยกหนี้ให้ หรือตัดเศษบัญชี)\n"
        "กลุ่มงานบริหารคลังสินค้าและผลิต"
    )
    new_ap = (
        "AP_WRITEOFF (PWO - Purchase Write-off - ใบสำคัญตัดหนี้): "
        "บันทึกการตัดยอดเจ้าหนี้ (เช่น ซัพพลายเออร์ยกหนี้ให้ หรือตัดเศษบัญชี)\n"
        "AP_CN (Purchase Credit Note - ใบลดหนี้ซื้อ): หักยอดเจ้าหนี้คงค้าง "
        "และปรับปรุงภาษีซื้อกับสต็อก ยอดติดลบในรายงานเจ้าหนี้และภาษีซื้อ ห้ามใช้แทนใบลดหนี้ขาย CN\n"
        "กลุ่มงานบริหารคลังสินค้าและผลิต"
    )
    text = text.replace(old_ap, new_ap)
    text = text.replace(
        "แล้วจึงอัปเดตลง products.cost_price",
        "แล้วจึงอัปเดตลง products.cost_price ซึ่งต้องเป็นทุนก่อน VAT ตาม TAS 2 เท่านั้น "
        "ราคาตามหน้าบิลรวม VAT อยู่ที่ products.last_invoice_unit_price และห้ามนำไปถัวเฉลี่ยสต็อก",
    )
    text = text.replace(
        "ระบบจะรันเลขที่ใบรับเงินชุด `CA01/XXXX` ผ่านฟังก์ชัน `generate_tier_1_2_cash_receipt_numbers` เพื่อใช้เป็นรายจ่ายทางภาษีนิติบุคคล",
        "ระบบรันเลขใบสำคัญรับเงิน `RCV-YYMM-XXXX` (ไม่ใช้ `CA01/XXXX`) "
        "รายงานกลุ่ม 1.2 ห้ามถอด VAT 7% เทียม ฐานสินค้าเท่ากับยอดรวมและภาษีเป็น 0 "
        "สถานะโอนหรือสดมาจาก RPC `get_ap_doc_settlement_modes` "
        "เอกสาร `AP_INV` ถูก Trigger `trg_enforce_ap_inv_non_vat_on_insert` ล็อกให้ `vat_amount = 0` และสถานะภาษี `TAX_READY`",
    )
    text = text.replace(
        "10. แผนสถาปัตยกรรมระบบเอกสารขาย E-Commerce และการกระทบยอด Statement ธนาคาร 3 ระยะ (Phase 24 Roadmap)",
        "10. มาตรฐานเอกสารขาย E-Commerce และการกระทบยอด Statement (Phase 24 — เสร็จแล้ว)",
    )
    marker = 'Net Profit Engine (กำไรสุทธิ):'
    start = text.find(marker)
    end = text.find("\n\n4. ", start)
    if start != -1 and end != -1:
        replacement = (
            "Net Profit Engine (กำไรสุทธิ): ตัวเลขบน Executive Dashboard และรายงานการเงิน "
            "มาจาก RPC `get_erp_financial_kpis_and_profit(p_start_date, p_end_date)` เท่านั้น "
            "สมการคือรายได้ก่อน VAT (รวม CS_TAX และฐานเงินมัดจำตาม TFRS 15 หัก CN) "
            "ลบต้นทุนเสื้อก่อน VAT ลบวัตถุดิบ BOM ลบวัสดุสิ้นเปลือง ลบค่าแรงบริการ ลบ OPEX "
            "และหัก AP_CN ในเจ้าหนี้ แสดงสกุลเงินเป็นบาท (฿) "
            "ห้ามใช้ `products.last_invoice_unit_price` เป็นต้นทุน"
        )
        text = text[:start] + replacement + text[end:]
    extra = """

## 11. มาตรฐานใบลดหนี้ซื้อและโควตา OCR (Phase 25–26)

- ใบลดหนี้ซื้อใช้รหัสเอกสาร `AP_CN` หักเจ้าหนี้คงค้างและปรับปรุงภาษีซื้อกับสต็อก ไม่ใช่เอกสารรับสินค้า
- เครื่อง OCR สลับโควตาอัตโนมัติ รีเซ็ตรายวันเวลา 14:00 น. เมื่อโมเดลหลักเต็ม 20/20 ให้ไปรุ่น Flash-Lite โควตา 500 บิลต่อวัน

## 12. มาตรฐานคู่ค้ารับช่วงต่อ (Phase 27)

- นิติบุคคลใหม่ผูกด้วย `contacts.succeeded_by_contact_id` และ `contacts.successor_note`
- เอกสารประวัติของนิติบุคคลเดิมต้องคงอยู่ ระบบโคลน `vendor_product_mapping` และ `contact_persons` ไปยังนิติบุคคลใหม่
- เลขผู้เสียภาษีและเลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก

## 13. มาตรฐานวัตถุดิบโรงงาน (Phase 29–30)

- วัตถุดิบและวัสดุสิ้นเปลืองไม่อยู่ใน `products` อยู่ที่ `mst_materials` ผูกหมวด `mst_material_categories`
- โหมด `BOM_BACKFLUSH` แปลงหน่วยซื้อเป็นหน่วยใช้ผ่าน `record_material_purchase_inbound` และตัดเมื่อผลิตเสร็จผ่าน `backflush_bom_for_production`
- โหมด `SHOP_FLOOR_ISSUE` คือการเบิกหน้าเครื่อง เช่น หมึกและฟิล์ม DTF
- โหมด `DIRECT_CONSUMABLE` ตัดเป็นต้นทุนทันทีเมื่อซื้อ และแจ้งเตือนเมื่อราคาซื้อเกิน `mst_materials.reference_purchase_price`
- บรรทัดเอกสารใช้ `document_items.material_id`, `item_nature`, `skip_stock_ledger` และห้ามลง `inventory_ledger`
- จับคู่รหัสบนบิลผู้ขายด้วย `upsert_material_vendor_mapping` โดย `material_vendor_mappings` มี `lookup_key`

## 14. มาตรฐานราคาตามบิลกับทุน TAS 2 (Phase 31–31.2)

- `products.last_invoice_unit_price` และ `last_invoice_vat_mode` เก็บราคาตามหน้าบิล เช่น 43.00, 48.00, 53.00 ใช้ Prefill หน้าคีย์รับสินค้าเท่านั้น
- `products.cost_price` เก็บทุนก่อน VAT เช่น 40.19, 44.86, 49.53 ใช้ตีมูลค่าสต็อกและคำนวณกำไรเท่านั้น
- เมื่อโหมด `INC_VAT` และ `last_invoice_unit_price` มากกว่า 0 ห้ามคูณ 1.07 ซ้ำ ถ้าไม่มีราคาตามบิลจึงใช้ `recover_inc_vat_unit_price`
- บันทึกสินค้า `INC_VAT` จาก Product Matrix: ตัวเลขที่กรอกเข้า `last_invoice_unit_price`, ตั้ง `last_invoice_vat_mode = INC_VAT`, `is_inc_vat_cost_normalized = true`, และ `cost_price` คือตัวเลขที่กรอกหาร 1.07 แล้วปัดเศษสตางค์
- โหมด `EXC_VAT` และ `NONE` บันทึกตัวเลขเดียวกันลงทั้ง `cost_price` และ `last_invoice_unit_price`
- Trigger `trg_snapshot_sales_item_tas2_cost` เติม `document_items.unit_cost_ex_vat` ตอนขาย
- หน้า `/purchases/manual-receipt` แสดงราคาตามบิลในช่องราคาซื้อ และแถวรายการเหลือ 2 บรรทัดโดยไม่พิมพ์รหัส SKU ซ้ำ

## 15. ลำดับเอกสารถัดไป (ยังไม่ขึ้น Production)

- Phase 32: แคตตาล็อกรูปตามรุ่นและสี และบอทค้นหารูปในกลุ่ม LINE ผ่าน OA `@hzr1801v`
- Phase 33: ใบขอซื้อวัตถุดิบจากหน้างาน แล้วอนุมัติเป็นใบสั่งซื้อ `PO-YYMM-XXXX` ก่อนรับเข้าคลัง
"""
    return text.rstrip() + "\n" + extra


def paragraph_xml(text: str, style: str | None = None) -> str:
    body = html.escape(text)
    style_xml = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
    return f"<w:p>{style_xml}<w:r><w:t xml:space=\"preserve\">{body}</w:t></w:r></w:p>"


def markdown_to_docx(markdown: str, destination: Path) -> None:
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        "<w:body>",
    ]
    for raw in markdown.splitlines():
        line = raw.rstrip()
        if not line:
            parts.append("<w:p/>")
            continue
        if line.startswith("# "):
            parts.append(paragraph_xml(line[2:].strip(), "Heading1"))
        elif line.startswith("## "):
            parts.append(paragraph_xml(line[3:].strip(), "Heading2"))
        else:
            parts.append(paragraph_xml(line))
    parts.append(
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
    )
    parts.append("</w:body></w:document>")
    document_xml = "".join(parts)
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    doc_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", content_types)
        package.writestr("_rels/.rels", rels)
        package.writestr("word/document.xml", document_xml)
        package.writestr("word/styles.xml", styles_xml)
        package.writestr("word/_rels/document.xml.rels", doc_rels)


def main() -> None:
    if not MARKDOWN.exists():
        MARKDOWN.write_text(build_markdown(), encoding="utf-8")
    markdown_to_docx(MARKDOWN.read_text(encoding="utf-8"), DOCX)
    print(f"wrote {DOCX.name} from {MARKDOWN.name}")


if __name__ == "__main__":
    main()

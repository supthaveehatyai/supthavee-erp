/**
 * ภ.ง.ด.50 ทวิ — layout จาก Template/202606_หักณที่จ่าย.pdf (กรมสรรพากร)
 */

export type Wht50TawiCertificateProps = {
  copyTitle: string;
  certNo: string;
  bookNo?: string;
  /** เช่น 24/06/69 */
  payDateShort: string;
  payer: {
    name: string;
    taxIdFormatted: string;
    address: string;
  };
  payee: {
    name: string;
    taxIdFormatted: string;
    address: string;
    entityType: string | null;
  };
  whtBase: number;
  whtAmount: number;
  /** ผลจาก numberToThaiBaht(wht_amount) */
  whtAmountText: string;
  /** ประเภทหัก ณ ที่จ่าย (เช่น ค่าบริการ/รับเหมา) */
  incomeCategoryLabel?: string | null;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Sq({ checked = false }: { checked?: boolean }) {
  return (
    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center border border-black text-[10px] font-bold leading-none">
      {checked ? "X" : ""}
    </span>
  );
}

function PartyBlock({
  title,
  name,
  address,
  taxIdFormatted,
  citizenId,
}: {
  title: string;
  name: string;
  address: string;
  taxIdFormatted: string;
  citizenId?: string;
}) {
  return (
    <div className="border-b border-black">
      <div className="grid grid-cols-[1fr_11.5rem] text-[12px] leading-snug">
        <div className="border-r border-black px-1.5 py-1">
          <p className="font-bold">{title}</p>
          <p className="mt-1">
            <span className="inline-block w-8">ชื่อ</span>
            <span className="font-semibold">{name}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-700">
            ( ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือ คณะบุคคล )
          </p>
          <p className="mt-1">
            <span className="inline-block w-8 align-top">ที่อยู่</span>
            <span className="inline-block max-w-[calc(100%-2rem)] align-top">
              {address}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-700">
            ( ให้ระบุ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด )
          </p>
        </div>
        <div className="px-1.5 py-1 text-[11px]">
          <p>เลขประจำตัวประชาชน</p>
          <p className="mt-0.5 font-mono tracking-wide">
            {citizenId || "- ---- ----- -- -"}
          </p>
          <p className="mt-2">เลขประจำตัวผู้เสียภาษีอากร</p>
          <p className="mt-0.5 font-mono text-[12px] font-semibold tracking-wide">
            {taxIdFormatted}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Wht50TawiCertificate({
  copyTitle,
  certNo,
  bookNo = "",
  payDateShort,
  payer,
  payee,
  whtBase,
  whtAmount,
  whtAmountText,
  incomeCategoryLabel,
}: Wht50TawiCertificateProps) {
  /**
   * ตามต้นฉบับกรมสรรพากร:
   * (4) ภ.ง.ด. 2ก. · (5) ภ.ง.ด. 3 · (7) ภ.ง.ด. 53
   * CORPORATE → (7) · INDIVIDUAL → (5) ภ.ง.ด. 3
   */
  const isPnd3 = payee.entityType === "INDIVIDUAL";
  const isPnd53 = payee.entityType === "CORPORATE";
  const payeeCitizen =
    payee.entityType === "INDIVIDUAL" ? payee.taxIdFormatted : undefined;

  return (
    <article className="mx-auto box-border flex w-[210mm] min-h-[297mm] flex-col border border-black bg-white p-[6mm] font-sarabun text-[14px] text-black print:m-0 print:border-0 print:p-[6mm]">
      {/* มุมบน — ชื่อฉบับ */}
      <p className="text-center text-[12px] font-bold leading-tight">
        {copyTitle}
      </p>

      {/* หัวเรื่อง + เล่มที่/เลขที่ */}
      <div className="mt-1 grid grid-cols-[1fr_auto] items-start gap-2">
        <div className="text-center">
          <h1 className="text-[16px] font-bold leading-tight">
            หนังสือรับรองการหักภาษี ณ ที่จ่าย
          </h1>
          <p className="text-[13px] font-semibold leading-tight">
            ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร
          </p>
        </div>
        <div className="min-w-[8rem] space-y-0.5 text-[12px]">
          <p>
            เล่มที่{" "}
            <span className="inline-block min-w-[4.5rem] border-b border-dotted border-black px-1 font-mono">
              {bookNo || "\u00a0"}
            </span>
          </p>
          <p>
            เลขที่{" "}
            <span className="inline-block min-w-[4.5rem] border-b border-dotted border-black px-1 font-mono font-semibold">
              {certNo}
            </span>
          </p>
        </div>
      </div>

      {/* ผู้หัก / ผู้ถูกหัก — ซ้อนแนวตั้งตามต้นฉบับ (แต่ละฝั่งซ้ายชื่อ-ที่อยู่ / ขวาเลขประจำตัว) */}
      <section className="mt-1.5 border border-black">
        <PartyBlock
          title="ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :-"
          name={payer.name}
          address={payer.address}
          taxIdFormatted={payer.taxIdFormatted}
        />
        <PartyBlock
          title="ผู้ถูกหักภาษี ณ ที่จ่าย :-"
          name={payee.name}
          address={payee.address}
          taxIdFormatted={payee.taxIdFormatted}
          citizenId={payeeCitizen}
        />

        {/* ลำดับที่ในแบบ + Checkbox ภ.ง.ด. */}
        <div className="grid grid-cols-[7.5rem_1fr] text-[11px]">
          <div className="border-r border-black px-1.5 py-1">
            <p>
              ลำดับที่{" "}
              <span className="inline-block min-w-[2.5rem] border-b border-dotted border-black" />{" "}
              ในแบบ
            </p>
            <p className="mt-0.5 text-[8px] leading-tight text-neutral-600">
              (ให้สามารถอ้างอิงหรือสอบยันกันได้ระหว่างลำดับที่ตามหนังสือรับรองฯ
              กับแบบยื่นรายการภาษีหักที่จ่าย)
            </p>
          </div>
          <div className="px-1.5 py-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Sq /> (1) ภ.ง.ด. 1ก.
              </span>
              <span className="inline-flex items-center gap-1">
                <Sq /> (2) ภ.ง.ด. 1ก.พิเศษ
              </span>
              <span className="inline-flex items-center gap-1">
                <Sq /> (3) ภ.ง.ด. 2
              </span>
              <span className="inline-flex items-center gap-1">
                <Sq /> (4) ภ.ง.ด. 2ก.
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Sq checked={isPnd3} /> (5) ภ.ง.ด. 3
              </span>
              <span className="inline-flex items-center gap-1">
                <Sq /> (6) ภ.ง.ด. 3ก.
              </span>
              <span className="inline-flex items-center gap-1">
                <Sq checked={isPnd53} /> (7) ภ.ง.ด. 53
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ตารางประเภทเงินได้ */}
      <section className="mt-0 flex-1">
        <table className="w-full border-collapse text-[11px] leading-tight">
          <thead>
            <tr>
              <th className="border border-black px-1 py-1 text-left font-bold">
                ประเภทเงินได้พึงประเมินที่จ่าย
              </th>
              <th className="w-[5.2rem] border border-black px-0.5 py-1 text-center font-bold leading-tight">
                วัน เดือน
                <br />
                หรือปีภาษี ที่จ่าย
              </th>
              <th className="w-[5rem] border border-black px-0.5 py-1 text-center font-bold leading-tight">
                จำนวนเงินที่จ่าย
              </th>
              <th className="w-[5rem] border border-black px-0.5 py-1 text-center font-bold leading-tight">
                ภาษีที่หัก
                <br />
                และนำส่งไว้
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-1 py-0.5">
                1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)
              </td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
            <tr>
              <td className="border border-black px-1 py-0.5">
                2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)
              </td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
            <tr>
              <td className="border border-black px-1 py-0.5">
                3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)
              </td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
            <tr>
              <td className="border border-black px-1 py-0.5 align-top text-[10px] leading-[1.25]">
                4. (ก) ค่าดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)
                <br />
                <span className="pl-3">
                  (ข) เงินปันผล ส่วนแบ่งของกำไร ฯลฯ ตามมาตรา 40 (4) (ข)
                </span>
                <br />
                <span className="pl-3">
                  (1) กรณีผู้ได้รับเงินปันผลได้รับเครดิตภาษี โดยจ่ายจากกำไรสุทธิของกิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราดังนี้
                </span>
                <br />
                <span className="pl-6">(1.1) อัตราร้อยละ 30 ของกำไรสุทธิ</span>
                <br />
                <span className="pl-6">(1.2) อัตราร้อยละ 25 ของกำไรสุทธิ</span>
                <br />
                <span className="pl-6">(1.3) อัตราร้อยละ 20 ของกำไรสุทธิ</span>
                <br />
                <span className="pl-6">
                  (1.4) อัตราอื่น ๆ (ระบุ) ............ ของกำไรสุทธิ
                </span>
                <br />
                <span className="pl-3">
                  (2) กิจการที่ได้รับยกเว้นภาษีเงินได้นิติบุคคลซึ่ง ผู้รับเงินปันผลไม่ได้รับเครดิตภาษี
                </span>
                <br />
                <span className="pl-6">
                  (2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นภาษีเงินได้นิติบุคคล
                </span>
                <br />
                <span className="pl-6">
                  (2.2) เงินปันผลหรือเงินส่วนแบ่งของกำไรที่ได้รับยกเว้นไม่ต้องนำมารวมคำนวณเป็นรายได้เพื่อเสียภาษีนิติบุคคล
                </span>
                <br />
                <span className="pl-6">
                  (2.3) กำไรสุทธิส่วนที่ได้หักผลขาดทุนสุทธิยกมาไม่เกิน 5 ปี
                  ก่อนรอบระยะเวลาบัญชีปัจจุบัน
                </span>
                <br />
                <span className="pl-6">
                  (2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)
                </span>
                <br />
                <span className="pl-6">(2.5) อัตราอื่น ๆ (ระบุ) ............</span>
              </td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
            <tr>
              <td className="border border-black px-1 py-1 align-top text-[10.5px] leading-snug">
                <span className="font-semibold">
                  5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตาม
                  มาตรา 3 เตรส
                </span>{" "}
                เช่น รางวัล ส่วนลดหรือประโยชน์ใดๆ เนื่องจากการส่งเสริมการขาย
                รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ
                ค่าบริการ ค่าขนส่ง ค่าจ้างทำของ ค่าจ้างโฆษณา ค่าเช่า
                ค่าเบี้ยประกันวินาศภัย ฯลฯ
                {incomeCategoryLabel?.trim() ? (
                  <span className="mt-0.5 block font-bold text-black">
                    ({incomeCategoryLabel.trim()})
                  </span>
                ) : null}
              </td>
              <td className="border border-black px-0.5 py-1 text-center align-middle font-mono text-[12px] font-semibold">
                {payDateShort}
              </td>
              <td className="border border-black px-1 py-1 text-right align-middle font-mono text-[12px] font-semibold tabular-nums">
                {formatMoney(whtBase)}
              </td>
              <td className="border border-black px-1 py-1 text-right align-middle font-mono text-[12px] font-semibold tabular-nums">
                {formatMoney(whtAmount)}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-1 py-0.5">
                6. อื่นๆ(ระบุ) ....................................................
              </td>
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
            <tr className="font-bold">
              <td className="border border-black px-1 py-1 text-center">
                รวมเงินที่จ่าย และ ภาษีที่นำส่ง
              </td>
              <td className="border border-black" />
              <td className="border border-black px-1 py-1 text-right font-mono tabular-nums">
                {formatMoney(whtBase)}
              </td>
              <td className="border border-black px-1 py-1 text-right font-mono tabular-nums">
                {formatMoney(whtAmount)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-[auto_1fr] border border-t-0 border-black text-[12px]">
          <div className="border-r border-black px-1.5 py-1 font-semibold">
            รวมเงินภาษีที่นำส่ง (ตัวอักษร)
          </div>
          <div className="px-2 py-1 text-center font-semibold">
            -- {whtAmountText} --
          </div>
        </div>

        {/* กองทุน / ประกันสังคม */}
        <div className="border border-t-0 border-black px-1.5 py-1 text-[10.5px] leading-snug">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Sq /> เงินสะสมจ่ายเข้ากองทุนสำรองเลี้ยงชีพ ใบอนุญาตเลขที่
            ........................ จำนวนเงิน ................ บาท
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Sq /> เงินสมทบจ่ายเข้ากองทุนประกันสังคม จำนวน ................ บาท
          </p>
          <p className="mt-0.5">
            เลขที่บัญชีนายจ้าง ........................{" "}
            เลขที่บัตรประกันสังคม ของผู้ถูกหักภาษี ณ ที่จ่าย ........................
          </p>
        </div>
      </section>

      {/* ลายเซ็น */}
      <section className="mt-0 grid grid-cols-[11rem_1fr] border border-t-0 border-black break-inside-avoid print:break-inside-avoid">
        <div className="border-r border-black px-1.5 py-1.5 text-[11px]">
          <p className="font-bold">ผู้จ่ายเงิน</p>
          <div className="mt-1 space-y-1">
            <p className="flex items-center gap-1.5">
              <Sq checked /> หักภาษี ณ ที่จ่าย
            </p>
            <p className="flex items-center gap-1.5">
              <Sq /> ออกภาษีให้ตลอดไป
            </p>
            <p className="flex items-center gap-1.5">
              <Sq /> ออกภาษีให้ครั้งเดียว
            </p>
            <p className="flex items-center gap-1.5">
              <Sq /> อื่นๆ (ระบุ) ............
            </p>
          </div>
        </div>

        <div className="relative px-2 py-1.5 text-[11px]">
          <p className="pr-20 leading-snug">
            ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้น
            ถูกต้องตรงกับความจริงทุกประการ
          </p>

          {/* วงกลมประทับตรา */}
          <div className="absolute right-2 top-1 flex h-[4.6rem] w-[4.6rem] flex-col items-center justify-center rounded-full border border-dashed border-black text-center text-[9px] leading-tight">
            <span>ประทับตรา</span>
            <span>นิติบุคคล</span>
            <span>(ถ้ามี)</span>
          </div>

          <div className="mt-8 flex flex-col items-center pr-20">
            <p>
              ลงชื่อ ............................................. ผู้มีหน้าที่หักภาษี
              ณ ที่จ่าย
            </p>
            <p className="mt-2">
              ............................................. วัน เดือน ปี
              ที่ออกหนังสือรับรองฯ
            </p>
            <p className="mt-1 font-mono text-[12px] font-semibold">
              {payDateShort}
            </p>
          </div>
        </div>
      </section>

      {/* ท้ายกระดาษ */}
      <footer className="mt-1.5 grid grid-cols-2 gap-3 text-[8.5px] leading-snug text-neutral-700">
        <div>
          <p>
            <span className="font-bold">คำเตือน</span> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี
            ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร
            ต้องรับโทษทางอาญา ตามมาตรา 35 แห่งประมวลรัษฎากร
          </p>
        </div>
        <div>
          <p>
            <span className="font-bold">หมายเหตุ</span> เลขประจำตัวผู้เสียภาษีอากร (13
            หลัก)* หมายถึง
          </p>
          <p>1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง</p>
          <p>2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า</p>
          <p>
            3. กรณีอื่น ๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร
            (13 หลัก)
          </p>
        </div>
      </footer>
    </article>
  );
}

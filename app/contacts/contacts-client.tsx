"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import VendorForm, { validateVendorOcrConfig } from "@/app/contacts/VendorForm";
import {
  DEFAULT_OCR_PATTERN_JSON,
  formatOcrPatternConfig,
  type Contact,
  type ContactFormValues,
  type ContactPersonInput,
  type ContactType,
  type CustomerType,
} from "@/app/contacts/contacts";
import {
  createContact,
  getContacts,
  importContacts,
} from "@/lib/actions/contacts";
import ManageContactDialog from "@/components/contacts/ManageContactDialog";
import ViewContactDialog from "@/components/contacts/ViewContactDialog";

type TypeFilter = "All" | ContactType;
type SortDirection = "asc" | "desc";

type CsvPreviewRow = {
  rowNumber: number;
  contact_type: string;
  customer_type: string;
  company_name: string;
  tax_id: string;
  branch_code: string;
  phone: string;
  address: string;
  default_price_tier: string;
  credit_days: string;
  errors: string[];
  isValid: boolean;
};

type ContactForm = ContactFormValues;

const CSV_HEADERS = [
  "contact_type",
  "customer_type",
  "company_name",
  "tax_id",
  "branch_code",
  "phone",
  "address",
  "default_price_tier",
  "credit_days",
] as const;

const CSV_TEMPLATE_ROWS = [
  [
    "Customer",
    "นิติบุคคล",
    "บริษัท ตัวอย่าง จำกัด",
    "1234567890123",
    "สำนักงานใหญ่",
    "074-000-000",
    "123 ถนนตัวอย่าง อ.หาดใหญ่ จ.สงขลา 90110",
    "Retail",
    "30",
  ],
  [
    "Vendor",
    "นิติบุคคล",
    "ห้างหุ้นส่วน ตัวอย่าง",
    "9876543210987",
    "สำนักงานใหญ่",
    "02-000-0000",
    "99 ถนนพหลโยธิน กรุงเทพฯ 10400",
    "Wholesale",
    "0",
  ],
];

function createPerson(): ContactPersonInput {
  return {
    clientId: crypto.randomUUID(),
    name: "",
    phone: "",
    departmentOrRole: "",
  };
}

function createEmptyForm(): ContactForm {
  return {
    contactType: "Customer",
    customerType: "นิติบุคคล",
    companyName: "",
    taxId: "",
    branchCode: "สำนักงานใหญ่",
    address: "",
    phone: "",
    ocrPatternConfigJson: DEFAULT_OCR_PATTERN_JSON,
    persons: [],
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvText(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsvTemplate() {
  const lines = [
    CSV_HEADERS.join(","),
    ...CSV_TEMPLATE_ROWS.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "contacts_import_template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function validateCsvRows(matrix: string[][]): CsvPreviewRow[] {
  if (matrix.length === 0) return [];

  const header = matrix[0].map((cell) => cell.trim().toLowerCase());
  const indexMap = Object.fromEntries(
    CSV_HEADERS.map((key) => [key, header.indexOf(key)]),
  ) as Record<(typeof CSV_HEADERS)[number], number>;

  const missingHeaders = CSV_HEADERS.filter((key) => indexMap[key] < 0);
  if (missingHeaders.length > 0) {
    return [
      {
        rowNumber: 1,
        contact_type: "",
        customer_type: "",
        company_name: "",
        tax_id: "",
        branch_code: "",
        phone: "",
        address: "",
        default_price_tier: "",
        credit_days: "",
        errors: [
          `หัวคอลัมน์ไม่ครบหรือไม่ถูกต้อง: ${missingHeaders.join(", ")}`,
        ],
        isValid: false,
      },
    ];
  }

  const get = (cells: string[], key: (typeof CSV_HEADERS)[number]) =>
    (cells[indexMap[key]] ?? "").trim();

  return matrix.slice(1).map((cells, index) => {
    const contactType = get(cells, "contact_type");
    const customerType = get(cells, "customer_type");
    const companyName = get(cells, "company_name");
    const taxId = get(cells, "tax_id");
    const branchCode = get(cells, "branch_code");
    const phone = get(cells, "phone");
    const address = get(cells, "address");
    const priceTier = get(cells, "default_price_tier");
    const creditDays = get(cells, "credit_days");
    const errors: string[] = [];

    if (
      contactType !== "Customer" &&
      contactType !== "Vendor" &&
      contactType !== "Technician"
    ) {
      errors.push("contact_type ต้องเป็น Customer, Vendor หรือ Technician");
    }
    if (!companyName) {
      errors.push("company_name ห้ามว่าง");
    }
    if (
      priceTier &&
      priceTier !== "Retail" &&
      priceTier !== "Wholesale"
    ) {
      errors.push("default_price_tier ต้องเป็น Retail หรือ Wholesale");
    }
    if (creditDays) {
      const parsed = Number(creditDays);
      if (!Number.isInteger(parsed) || parsed < 0) {
        errors.push("credit_days ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      }
    }

    return {
      rowNumber: index + 2,
      contact_type: contactType,
      customer_type: customerType,
      company_name: companyName,
      tax_id: taxId,
      branch_code: branchCode,
      phone,
      address,
      default_price_tier: priceTier,
      credit_days: creditDays,
      errors,
      isValid: errors.length === 0,
    };
  });
}

function Icon({
  name,
  className = "size-4",
}: {
  name:
    | "plus"
    | "search"
    | "close"
    | "trash"
    | "users"
    | "building"
    | "download"
    | "upload"
    | "sort";
  className?: string;
}) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    building: (
      <>
        <path d="M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1M2 21h20" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    upload: (
      <>
        <path d="M12 21V9" />
        <path d="m7 14 5-5 5 5" />
        <path d="M5 3h14" />
      </>
    ),
    sort: (
      <>
        <path d="m7 4 3 4H4z" />
        <path d="M7 8v12" />
        <path d="m17 20-3-4h6z" />
        <path d="M17 16V4" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

const fieldClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50";

export default function ContactsClient({
  initialContacts = [],
  initialError = "",
}: {
  initialContacts?: Contact[];
  initialError?: string;
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [isLoading, setIsLoading] = useState(initialContacts.length === 0 && !initialError);
  const [loadError, setLoadError] = useState(initialError);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<ContactForm>(createEmptyForm);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<CsvPreviewRow[]>([]);
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [manageContact, setManageContact] = useState<Contact | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [viewContactId, setViewContactId] = useState<string | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  useEffect(() => {
    setContacts(initialContacts);
    setLoadError(initialError);
    if (initialContacts.length > 0 || initialError) {
      setIsLoading(false);
    }
  }, [initialContacts, initialError]);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    const result = await getContacts();
    if (result.error) {
      setContacts([]);
      setLoadError(result.error);
    } else {
      setContacts(result.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (initialContacts.length > 0 || initialError) {
      setIsLoading(false);
      return;
    }
    void loadContacts();
  }, [initialContacts.length, initialError, loadContacts]);

  useEffect(() => {
    if (!isDialogOpen && !isImportOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isImportOpen && !isImporting) {
        setIsImportOpen(false);
        return;
      }
      if (isDialogOpen && !isSaving) setIsDialogOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDialogOpen, isSaving, isImportOpen, isImporting]);

  const filteredContacts = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");

    const filtered = contacts.filter((contact) => {
      if (typeFilter !== "All" && contact.contact_type !== typeFilter) {
        return false;
      }
      if (!keyword) return true;
      return [
        contact.company_name,
        contact.customer_type,
        contact.phone,
        contact.tax_id,
        contact.address,
        contact.branch_code,
      ].some((value) => value?.toLocaleLowerCase("th").includes(keyword));
    });

    return [...filtered].sort((left, right) => {
      const compared = left.company_name.localeCompare(
        right.company_name,
        "th",
        { sensitivity: "base" },
      );
      return sortDirection === "asc" ? compared : -compared;
    });
  }, [contacts, search, typeFilter, sortDirection]);

  const customerCount = contacts.filter(
    (contact) => contact.contact_type === "Customer",
  ).length;
  const vendorCount = contacts.filter(
    (contact) => contact.contact_type === "Vendor",
  ).length;
  const technicianCount = contacts.filter(
    (contact) => contact.contact_type === "Technician",
  ).length;
  const importInvalidCount = importRows.filter((row) => !row.isValid).length;
  const canImport =
    importRows.length > 0 &&
    importInvalidCount === 0 &&
    !isImporting;

  function openDialog() {
    setForm(createEmptyForm());
    setFormError("");
    setIsDialogOpen(true);
  }

  function closeDialog() {
    if (!isSaving) setIsDialogOpen(false);
  }

  function openImportDialog() {
    setImportFileName("");
    setImportRows([]);
    setImportError("");
    setIsImportOpen(true);
  }

  function closeImportDialog() {
    if (!isImporting) setIsImportOpen(false);
  }

  function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportError("");
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const matrix = parseCsvText(text);
        if (matrix.length < 2) {
          setImportRows([]);
          setImportError("ไฟล์ CSV ต้องมีหัวคอลัมน์และข้อมูลอย่างน้อย 1 แถว");
          return;
        }
        setImportRows(validateCsvRows(matrix));
      } catch (error) {
        setImportRows([]);
        setImportError(
          error instanceof Error
            ? error.message
            : "ไม่สามารถอ่านไฟล์ CSV ได้",
        );
      }
    };
    reader.onerror = () => {
      setImportRows([]);
      setImportError("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    };
    reader.readAsText(file, "UTF-8");
  }

  async function handleImportSubmit() {
    if (!canImport) return;
    setIsImporting(true);
    setImportError("");

    const payload = importRows.map((row) => ({
      contact_type: row.contact_type as ContactType,
      customer_type: row.customer_type || "บุคคลธรรมดา",
      company_name: row.company_name,
      tax_id: row.tax_id || null,
      branch_code: row.branch_code || "สำนักงานใหญ่",
      phone: row.phone || null,
      address: row.address || null,
      default_price_tier:
        row.default_price_tier === "Wholesale" ||
        row.default_price_tier === "Retail"
          ? row.default_price_tier
          : "Retail",
      credit_days: row.credit_days ? Number(row.credit_days) : 0,
    }));

    const result = await importContacts(payload);
    if (!result.success) {
      setImportError(result.error ?? "นำเข้าข้อมูลไม่สำเร็จ");
      setIsImporting(false);
      return;
    }

    await loadContacts();
    setIsImporting(false);
    setIsImportOpen(false);
    setImportRows([]);
    setImportFileName("");
  }

  function updateForm<Key extends keyof Omit<ContactForm, "persons">>(
    key: Key,
    value: ContactForm[Key],
  ) {
    setForm((current) => {
      const next: ContactForm = { ...current, [key]: value };
      if (key === "contactType") {
        const nextType = value as ContactType;
        if (nextType !== "Vendor") {
          next.ocrPatternConfigJson = DEFAULT_OCR_PATTERN_JSON;
        } else if (!current.ocrPatternConfigJson.trim()) {
          next.ocrPatternConfigJson = formatOcrPatternConfig({});
        }
      }
      return next;
    });
  }

  function addPerson() {
    setForm((current) => ({
      ...current,
      persons: [...current.persons, createPerson()],
    }));
  }

  function updatePerson(
    clientId: string,
    key: Exclude<keyof ContactPersonInput, "clientId">,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      persons: current.persons.map((person) =>
        person.clientId === clientId ? { ...person, [key]: value } : person,
      ),
    }));
  }

  function removePerson(clientId: string) {
    setForm((current) => ({
      ...current,
      persons: current.persons.filter(
        (person) => person.clientId !== clientId,
      ),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    const companyName = form.companyName.trim();
    if (!companyName) {
      setFormError("กรุณากรอกชื่อบริษัทหรือชื่อคู่ค้า");
      return;
    }

    const incompletePerson = form.persons.find(
      (person) =>
        !person.name.trim() &&
        (person.phone.trim() || person.departmentOrRole.trim()),
    );
    if (incompletePerson) {
      setFormError("กรุณากรอกชื่อของผู้ประสานงานให้ครบถ้วน");
      return;
    }

    let ocrPatternConfig = {};
    if (form.contactType === "Vendor") {
      const ocrResult = validateVendorOcrConfig(form.ocrPatternConfigJson);
      if (!ocrResult.ok) {
        setFormError(ocrResult.error);
        return;
      }
      ocrPatternConfig = ocrResult.value;
    }

    const persons = form.persons.filter((person) => person.name.trim());
    setIsSaving(true);

    const result = await createContact({
      contactType: form.contactType,
      customerType: form.customerType,
      companyName,
      taxId: form.taxId.trim() || null,
      branchCode: form.branchCode.trim() || "สำนักงานใหญ่",
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      ocrPatternConfig:
        form.contactType === "Vendor" ? ocrPatternConfig : {},
      persons: persons.map((person) => ({
        name: person.name.trim(),
        phone: person.phone.trim() || null,
        departmentOrRole: person.departmentOrRole.trim() || null,
      })),
    });

    if (result.error || !result.data) {
      setFormError(result.error ?? "ไม่สามารถสร้างข้อมูลคู่ค้าได้");
      setIsSaving(false);
      return;
    }

    setContacts((current) => [result.data!, ...current]);
    setIsSaving(false);
    setIsDialogOpen(false);
    setForm(createEmptyForm());
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-blue-600">ฐานข้อมูลหลัก</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            คู่ค้าและผู้ติดต่อ
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            จัดการข้อมูลองค์กร ลูกค้า ซัพพลายเออร์ และผู้ประสานงาน
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openImportDialog}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            <Icon name="upload" />
            นำเข้าข้อมูล CSV
          </button>
          <button
            type="button"
            onClick={openDialog}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Icon name="plus" />
            เพิ่มคู่ค้าใหม่
          </button>
        </div>
      </header>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                รายชื่อองค์กรและคู่ค้า
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                แสดง {filteredContacts.length.toLocaleString("th-TH")} จาก{" "}
                {contacts.length.toLocaleString("th-TH")} รายการ
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block sm:w-72">
                <span className="sr-only">ค้นหาคู่ค้า</span>
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <Icon name="search" />
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหาชื่อ เบอร์โทร หรือเลขผู้เสียภาษี..."
                  className={`${fieldClass} h-9 bg-slate-50 pl-9 text-xs focus:bg-white`}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setSortDirection((current) =>
                    current === "asc" ? "desc" : "asc",
                  )
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <Icon name="sort" className="size-3.5" />
                ชื่อบริษัท {sortDirection === "asc" ? "A→Z" : "Z→A"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "All", label: "ทั้งหมด", count: contacts.length },
                { key: "Customer", label: "ลูกค้า", count: customerCount },
                { key: "Vendor", label: "ผู้จำหน่าย", count: vendorCount },
                { key: "Technician", label: "ช่างรับเหมา", count: technicianCount },
              ] as const
            ).map((tab) => {
              const active = typeFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTypeFilter(tab.key)}
                  className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-600/20"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-white text-slate-500"
                    }`}
                  >
                    {tab.count.toLocaleString("th-TH")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="border-b border-slate-200 bg-slate-50/80">
              <tr>
                {[
                  "ชื่อองค์กร / คู่ค้า",
                  "ประเภทคู่ค้า",
                  "ประเภทลูกค้า",
                  "เบอร์โทร",
                  "เลขผู้เสียภาษี",
                  "ระดับราคา",
                  "เครดิต (วัน)",
                  "สถานะ",
                  "จัดการ",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-5 py-3 text-[11px] font-semibold tracking-wide text-slate-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <tr key={row} className="animate-pulse">
                    {Array.from({ length: 9 }).map((__, cell) => (
                      <td key={cell} className="px-5 py-4">
                        <div className="h-3.5 rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : loadError ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center">
                    <p className="text-sm font-medium text-red-600">
                      ไม่สามารถโหลดข้อมูลคู่ค้าได้
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{loadError}</p>
                    <button
                      type="button"
                      onClick={() => void loadContacts()}
                      className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      ลองอีกครั้ง
                    </button>
                  </td>
                </tr>
              ) : filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center">
                    <div className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400">
                      <Icon
                        name={
                          search || typeFilter !== "All" ? "search" : "building"
                        }
                      />
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-600">
                      {search || typeFilter !== "All"
                        ? "ไม่พบข้อมูลที่ค้นหา"
                        : "ยังไม่มีข้อมูลคู่ค้า"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {search || typeFilter !== "All"
                        ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง"
                        : "เริ่มต้นโดยกดปุ่ม “เพิ่มคู่ค้าใหม่” หรือนำเข้า CSV"}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="transition hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-slate-800">
                        {contact.company_name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {contact.branch_code || "สำนักงานใหญ่"}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          contact.contact_type === "Customer"
                            ? "bg-blue-50 text-blue-700"
                            : contact.contact_type === "Technician"
                              ? "bg-violet-50 text-violet-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {contact.contact_type === "Customer"
                          ? "ลูกค้า"
                          : contact.contact_type === "Technician"
                            ? "ช่างรับเหมา"
                            : "ผู้จำหน่าย"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {contact.customer_type || "บุคคลธรรมดา"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {contact.phone || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {contact.tax_id || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {contact.default_price_tier || "Retail"}
                    </td>
                    <td className="px-5 py-4 text-xs tabular-nums text-slate-600">
                      {contact.credit_days ?? 0}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                          contact.is_active
                            ? "text-emerald-700"
                            : "text-slate-400"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            contact.is_active
                              ? "bg-emerald-500"
                              : "bg-slate-300"
                          }`}
                        />
                        {contact.is_active ? "ใช้งาน" : "ปิดใช้งาน"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setViewContactId(contact.id);
                            setIsViewOpen(true);
                          }}
                          className="inline-flex h-8 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                          ดูรายละเอียด
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setManageContact(contact);
                            setIsManageOpen(true);
                          }}
                          className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          จัดการ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ViewContactDialog
        contactId={viewContactId}
        open={isViewOpen}
        onOpenChange={(next) => {
          setIsViewOpen(next);
          if (!next) setViewContactId(null);
        }}
      />

      <ManageContactDialog
        contact={manageContact}
        open={isManageOpen}
        onOpenChange={(next) => {
          setIsManageOpen(next);
          if (!next) setManageContact(null);
        }}
      />

      {isDialogOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[2px] sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-dialog-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
          >
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6 sm:py-5">
              <div>
                <h2
                  id="contact-dialog-title"
                  className="text-lg font-bold text-slate-900"
                >
                  เพิ่มคู่ค้าใหม่
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  บันทึกข้อมูลองค์กรและผู้ประสานงานได้หลายคนในครั้งเดียว
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSaving}
                aria-label="ปิดหน้าต่าง"
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                <VendorForm
                  showOcrConfig={form.contactType === "Vendor"}
                  ocrPatternConfigJson={form.ocrPatternConfigJson}
                  onOcrPatternConfigJsonChange={(json) =>
                    updateForm("ocrPatternConfigJson", json)
                  }
                  disabled={isSaving}
                >
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <div className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600">
                      <Icon name="building" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">
                        ข้อมูลคู่ค้า
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        ข้อมูลสำหรับเอกสารและการติดต่อหลัก
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        ประเภทคู่ค้า <span className="text-red-500">*</span>
                      </span>
                      <select
                        value={form.contactType}
                        onChange={(event) =>
                          updateForm(
                            "contactType",
                            event.target.value as ContactType,
                          )
                        }
                        className={fieldClass}
                      >
                        <option value="Customer">ลูกค้า</option>
                        <option value="Vendor">ซัพพลายเออร์</option>
                        <option value="Technician">ช่างรับเหมา</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        ประเภทลูกค้า <span className="text-red-500">*</span>
                      </span>
                      <select
                        value={form.customerType}
                        onChange={(event) =>
                          updateForm(
                            "customerType",
                            event.target.value as CustomerType,
                          )
                        }
                        className={fieldClass}
                      >
                        <option value="นิติบุคคล">นิติบุคคล</option>
                        <option value="บุคคลธรรมดา">บุคคลธรรมดา</option>
                      </select>
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        ชื่อบริษัท / ชื่อคู่ค้า{" "}
                        <span className="text-red-500">*</span>
                      </span>
                      <input
                        autoFocus
                        required
                        value={form.companyName}
                        onChange={(event) =>
                          updateForm("companyName", event.target.value)
                        }
                        placeholder="ชื่อบริษัท ร้านค้า หรือบุคคล"
                        className={fieldClass}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        เลขประจำตัวผู้เสียภาษี
                      </span>
                      <input
                        inputMode="numeric"
                        maxLength={20}
                        value={form.taxId}
                        onChange={(event) =>
                          updateForm("taxId", event.target.value)
                        }
                        placeholder="เลขประจำตัว 13 หลัก"
                        className={fieldClass}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        สาขา
                      </span>
                      <input
                        value={form.branchCode}
                        onChange={(event) =>
                          updateForm("branchCode", event.target.value)
                        }
                        placeholder="สำนักงานใหญ่"
                        className={fieldClass}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        เบอร์โทรองค์กร
                      </span>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(event) =>
                          updateForm("phone", event.target.value)
                        }
                        placeholder="เช่น 074-000-000"
                        className={fieldClass}
                      />
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                        ที่อยู่
                      </span>
                      <textarea
                        rows={3}
                        value={form.address}
                        onChange={(event) =>
                          updateForm("address", event.target.value)
                        }
                        placeholder="ที่อยู่สำหรับออกเอกสาร"
                        className={`${fieldClass} h-auto resize-none py-2.5`}
                      />
                    </label>
                  </div>
                </section>

                <section className="border-t border-slate-200 pt-6">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <div className="grid size-8 place-items-center rounded-lg bg-violet-50 text-violet-600">
                        <Icon name="users" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800">
                          ผู้ประสานงาน
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          เพิ่มได้หลายคน โดยคนแรกจะเป็นผู้ติดต่อหลัก
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addPerson}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                    >
                      <Icon name="plus" />
                      เพิ่มผู้ประสานงาน
                    </button>
                  </div>

                  {form.persons.length === 0 ? (
                    <button
                      type="button"
                      onClick={addPerson}
                      className="flex w-full flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-7 text-center transition hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <span className="grid size-9 place-items-center rounded-full bg-white text-slate-400 shadow-sm">
                        <Icon name="plus" />
                      </span>
                      <span className="mt-2 text-xs font-medium text-slate-600">
                        ยังไม่มีผู้ประสานงาน
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-400">
                        กดเพื่อเพิ่มรายชื่อแรก
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {form.persons.map((person, index) => (
                        <div
                          key={person.clientId}
                          className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="grid size-6 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                                {index + 1}
                              </span>
                              <p className="text-xs font-semibold text-slate-700">
                                ผู้ประสานงานคนที่ {index + 1}
                              </p>
                              {index === 0 && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                  ผู้ติดต่อหลัก
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removePerson(person.clientId)}
                              aria-label={`ลบผู้ประสานงานคนที่ ${index + 1}`}
                              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="block">
                              <span className="mb-1.5 block text-[11px] font-medium text-slate-600">
                                ชื่อ-นามสกุล{" "}
                                <span className="text-red-500">*</span>
                              </span>
                              <input
                                value={person.name}
                                onChange={(event) =>
                                  updatePerson(
                                    person.clientId,
                                    "name",
                                    event.target.value,
                                  )
                                }
                                placeholder="ชื่อผู้ติดต่อ"
                                className={fieldClass}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1.5 block text-[11px] font-medium text-slate-600">
                                เบอร์โทร
                              </span>
                              <input
                                type="tel"
                                value={person.phone}
                                onChange={(event) =>
                                  updatePerson(
                                    person.clientId,
                                    "phone",
                                    event.target.value,
                                  )
                                }
                                placeholder="เบอร์โทรศัพท์"
                                className={fieldClass}
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1.5 block text-[11px] font-medium text-slate-600">
                                ตำแหน่ง / แผนก
                              </span>
                              <input
                                value={person.departmentOrRole}
                                onChange={(event) =>
                                  updatePerson(
                                    person.clientId,
                                    "departmentOrRole",
                                    event.target.value,
                                  )
                                }
                                placeholder="เช่น ฝ่ายจัดซื้อ"
                                className={fieldClass}
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                </VendorForm>

                {formError && (
                  <div
                    role="alert"
                    className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                  >
                    {formError}
                  </div>
                )}
              </div>

              <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isSaving}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex h-9 min-w-28 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                >
                  {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {isImportOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[2px] sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeImportDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
          >
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2
                  id="import-dialog-title"
                  className="text-lg font-bold text-slate-900"
                >
                  นำเข้าข้อมูล CSV
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  3-Layer Protection: Template → Upload → Pre-Validate
                </p>
              </div>
              <button
                type="button"
                onClick={closeImportDialog}
                disabled={isImporting}
                aria-label="ปิดหน้าต่างนำเข้า"
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                    1
                  </span>
                  <h3 className="text-sm font-semibold text-slate-800">
                    ดาวน์โหลด Template
                  </h3>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  ใช้ไฟล์ตัวอย่างเพื่อให้หัวคอลัมน์ตรงกับระบบก่อนกรอกข้อมูลจริง
                </p>
                <button
                  type="button"
                  onClick={downloadCsvTemplate}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                >
                  <Icon name="download" className="size-3.5" />
                  ดาวน์โหลด Template
                </button>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                    2
                  </span>
                  <h3 className="text-sm font-semibold text-slate-800">
                    อัปโหลดไฟล์ CSV
                  </h3>
                </div>
                <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/40">
                  <span className="grid size-10 place-items-center rounded-full bg-white text-blue-600 shadow-sm">
                    <Icon name="upload" />
                  </span>
                  <span className="mt-3 text-sm font-semibold text-slate-700">
                    เลือกไฟล์ CSV
                  </span>
                  <span className="mt-1 text-xs text-slate-400">
                    {importFileName || "รองรับไฟล์ .csv (UTF-8)"}
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={handleCsvFileChange}
                  />
                </label>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                      3
                    </span>
                    <h3 className="text-sm font-semibold text-slate-800">
                      Pre-Validate Preview
                    </h3>
                  </div>
                  {importRows.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {importRows.length.toLocaleString("th-TH")} แถว ·{" "}
                      <span
                        className={
                          importInvalidCount > 0
                            ? "font-semibold text-red-600"
                            : "font-semibold text-emerald-600"
                        }
                      >
                        ผิดปกติ {importInvalidCount.toLocaleString("th-TH")}
                      </span>
                    </p>
                  )}
                </div>

                {importRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-xs text-slate-400">
                    อัปโหลดไฟล์เพื่อแสดง Preview และตรวจสอบข้อมูลก่อนบันทึก
                  </div>
                ) : (
                  <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[980px] text-left">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          {[
                            "แถว",
                            "contact_type",
                            "company_name",
                            "customer_type",
                            "phone",
                            "price_tier",
                            "credit_days",
                            "สถานะ",
                          ].map((heading) => (
                            <th
                              key={heading}
                              className="border-b border-slate-200 px-3 py-2.5 text-[10px] font-semibold text-slate-500"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.map((row) => (
                          <tr
                            key={row.rowNumber}
                            className={
                              row.isValid
                                ? "bg-white"
                                : "bg-red-50 text-red-800"
                            }
                          >
                            <td className="px-3 py-2.5 text-xs font-semibold">
                              {row.rowNumber}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.contact_type || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs font-medium">
                              {row.company_name || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.customer_type || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.phone || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.default_price_tier || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.credit_days || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {row.isValid ? (
                                <span className="font-medium text-emerald-700">
                                  ผ่าน
                                </span>
                              ) : (
                                <span className="font-medium text-red-700">
                                  {row.errors.join(" · ")}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {importError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                >
                  {importError}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-slate-500">
                ปุ่มบันทึกจะเปิดใช้เมื่อข้อมูล Preview ถูกต้อง 100%
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeImportDialog}
                  disabled={isImporting}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportSubmit()}
                  disabled={!canImport}
                  className="inline-flex h-9 min-w-40 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isImporting ? "กำลังบันทึก..." : "บันทึกลงฐานข้อมูล"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const skillDir = 'C:/STV_ERP/gemini-skills/gun';
fs.mkdirSync(skillDir, { recursive: true });

const cursorRulesPath = path.join(projectRoot, '.cursorrules');
const cursorRules = fs.existsSync(cursorRulesPath)
  ? fs.readFileSync(cursorRulesPath, 'utf8').trim()
  : '';

const skillMd = [
  '---',
  'name: gun',
  'description: "Lead Full-Stack Developer และ ERP Systems Architect ประจำโปรเจกต์ Supthavee ERP (Next.js 16, Supabase Cloud, Vercel, TFRS/GAAP) ใช้เมื่อต้องการออกแบบฐานข้อมูล เขียน SQL/RPC สร้าง Cursor Prompt หรือแก้ไขบั๊กระบบทรัพย์ทวี ERP"',
  '---',
  '',
  '# กันต์ (Gun) - Supthavee ERP Lead Architect',
  '',
  'คุณคือ "กันต์" (Gun) - Lead Full-Stack Developer & ERP Systems Architect ประจำโปรเจกต์ Supthavee_ERP_Application',
  'ก่อนตอบคำถาม ออกแบบ SQL/RPC หรือเขียน Cursor Prompt ทุกครั้ง ให้อ้างอิงโครงสร้างจริงจากไฟล์ประกอบใน Skill นี้เสมอ (`database-schema.md`, `blueprint.md`, `Supthavee_ERP_Roadmap.md`, `Supthavee_ERP_Document_Standards.md`, `Supthavee_ERP_Summary.md`, `supthavee-codebase-audit.txt`, และ `Supabase Snippet-SchemaDump.csv`)',
  '',
  cursorRules,
  '',
].join('\n');

fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf8');

const refFiles = [
  'blueprint.md',
  'database-schema.md',
  'Supthavee_ERP_Roadmap.md',
  'Supthavee_ERP_Document_Standards.md',
  'Supthavee_ERP_Summary.md',
  'supthavee-codebase-audit.txt',
  'Supabase Snippet-SchemaDump.csv',
];

for (const file of refFiles) {
  const src = path.join(projectRoot, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(skillDir, file));
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Missing in project root (skip): ${file}`);
  }
}

console.log(`\nReady to upload folder: ${skillDir}`);

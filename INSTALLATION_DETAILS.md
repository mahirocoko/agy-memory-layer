# 📦 คู่มือและรายละเอียดการติดตั้ง `agy-memory-layer` (Installation Lifecycle)

เอกสารฉบับนี้อธิบายอย่างละเอียดว่า เมื่อรันสคริปต์ `./plugins/agy-memory-layer/scripts/install.sh` ระบบจะไปทำอะไร ที่ไหน อย่างไรบ้าง ทั้งในเครื่องของคุณและในระบบของ Antigravity CLI

---

## 🗺️ แผนผังโฟลเดอร์และ Path ทั้งหมดที่เกี่ยวข้อง

```text
[เครื่องของคุณ / Host Machine]
│
├── 1. Source Repository (ที่ตั้งโปรเจกต์นี้)
│   └── plugins/agy-memory-layer/
│       ├── plugin.json
│       ├── hooks.json
│       ├── agents/                  [First-Class Subagent Manifests (6 Subagents)]
│       ├── prompts/                 [Prompt Warehouse (system, persona, subagents)]
│       ├── rules/AGENTS.md
│       ├── skills/*/SKILL.md
│       └── scripts/*.js / *.sh
│
├── 2. Antigravity Plugins Directory (ระดับ Global)
│   └── ~/.gemini/antigravity-cli/plugins/
│       └── agy-memory-layer  ─────────────► [Symlink ชี้กลับมาที่ Source Repo]
│
└── 3. Memory Git Storage Directory (ที่เก็บข้อมูล Memory)
    └── ~/.gemini/memory/                    [Git Repository แยกอิสระ]
        ├── .git/                            [Commit History & Snapshots]
        ├── global/
        │   ├── human.md                     [User Profile & Preferences]
        │   └── persona.md                   [Agent Persona]
        └── projects/
            └── <project-slug>/              [แยกตามชื่อแต่ละโปรเจกต์]
                ├── project.md
                ├── rules.md
                └── learnings/
---

## ⚡ วิธีการติดตั้ง (Installation Methods)

### 1. แบบ One-Liner (คำสั่งเดียว ไม่ต้อง Clone - แนะนำ)
รันคำสั่งนี้ใน Terminal เครื่องใดก็ได้:
```bash
curl -fsSL https://raw.githubusercontent.com/mahirocoko/agy-memory-layer/main/install.sh | bash
```

### 2. แบบ Clone Source Code
```bash
git clone https://github.com/mahirocoko/agy-memory-layer.git
cd agy-memory-layer
./install.sh
```

---

## 🔍 ขั้นตอนการทำงานของ `install.sh` อย่างละเอียด (Step-by-Step)

### Step 1: ปรับสิทธิ์การรันไฟล์ Script (Permissions)
- **คำสั่ง**: `chmod +x plugins/agy-memory-layer/scripts/*.sh`
- **สิ่งที่เกิดขึ้น**: ให้สิทธิ์ execute กับสคริปต์ทั้งหมดในโฟลเดอร์ `scripts/` เพื่อให้ Antigravity CLI สามารถเรียกใช้งาน Hook และ Palace Generator ได้

### Step 2: สร้างและตั้งค่า Git Memory Repository (`~/.gemini/memory/`)
- **โฟลเดอร์เป้าหมาย**: `/Users/<username>/.gemini/memory/`
- **สิ่งที่เกิดขึ้น**:
  1. สร้างโฟลเดอร์ `~/.gemini/memory/global/` และ `~/.gemini/memory/projects/`
  2. ตรวจสอบว่ามี `.git/` อยู่หรือไม่ ถ้ายังไม่มีจะสั่ง:
     ```bash
     git init -b main
     ```
  3. สร้างไฟล์ Template เริ่มต้น (หากยังไม่มี):
     - `global/human.md` : ใส่ค่าเริ่มต้น เช่น การใช้ `-E` flag, ภาษาที่ชอบ, การเขียนโค้ดแบบ strict type
     - `global/persona.md` : กำหนดบทบาทของ Agent ให้เป็น Stateful Pair Programmer
  4. ทำการ Commit ครั้งแรก:
     ```bash
     git add -A && git commit -m "memory-layer: initial memory repository bootstrap"
     ```

### Step 3: ทำการเชื่อมโยง Plugin เข้ากับ Antigravity CLI (Symlink)
- **โฟลเดอร์เป้าหมาย**: `~/.gemini/antigravity-cli/plugins/`
- **สิ่งที่เกิดขึ้น**:
  1. สร้างโฟลเดอร์ `~/.gemini/antigravity-cli/plugins/` หากยังไม่มี
  2. ลบ Symlink เก่าที่อาจตกค้าง (เช่น `memfs`)
  3. สร้าง Symbolic Link จาก Source โฟลเดอร์ไปยังระบบของ Antigravity CLI:
     ```bash
     ln -sf "/path/to/plugins/agy-memory-layer" "~/.gemini/antigravity-cli/plugins/agy-memory-layer"
     ```
  *ผลลัพธ์: ทำให้ Antigravity CLI ค้นพบ Plugin นี้ในฐานะ Global Plugin โดยอัตโนมัติ ไม่ว่าจะเปิดทำงานในโฟลเดอร์ไหน*

### Step 4: ทดสอบความถูกต้องของ Hook Scripts (Sanity Check)
- **สิ่งที่เกิดขึ้น**:
  1. ทดลองยิง Mock JSON เข้า `hook-inject-memory.sh` เพื่อเช็คว่า Script ไม่ Error และส่ง JSON ออกมาได้ถูกต้อง
  2. ทดลองยิง Mock JSON เข้า `hook-auto-commit.sh` เพื่อตรวจสอบสิทธิ์การ Commit

---

## ⚡ วงจรการทำงานเมื่อ Agent ทำงานจริง (Runtime Lifecycle)

เมื่อติดตั้งเสร็จแล้ว ในทุกๆ ครั้งที่คุณใช้งาน Antigravity CLI:

```mermaid
sequenceDiagram
    autonumber
    participant User as 👤 User
    participant Engine as 🤖 Antigravity CLI
    participant Hook as 🪝 PreInvocation Hook
    participant Mem as 📁 ~/.gemini/memory
    participant Commit as 🪝 Stop Hook

    User->>Engine: พิมพ์คำสั่ง / ข้อความ
    Engine->>Hook: เรียก hook-inject-memory.sh
    Hook->>Mem: ดึง human.md + project.md ของโฟลเดอร์ปัจจุบัน
    Hook-->>Engine: Inject ข้อความเป็น System Prompt ล่าสุด
    Engine->>User: ประมวลผลและตอบกลับพร้อมบริบท
    Engine->>Commit: จบการทำงาน (Stop Event)
    Commit->>Mem: git add . && git commit (บันทึก Snapshot อัตโนมัติ)
```

---

## 🔄 รายละเอียดการอัปเดตเวอร์ชันใหม่ (`update.sh`)

เมื่อมีการอัปเดตโค้ดหรือฟีเจอร์ใหม่ของปลั๊กอิน (เช่น UI ใหม่, ฟีเจอร์ Memory Palace ใหม่):

```bash
# อัปเดตด้วยสคริปต์อัตโนมัติ (1 คำสั่งจบ)
./plugins/agy-memory-layer/scripts/update.sh
```

**สิ่งที่สคริปต์อัปเดตจัดการให้:**
1. **Pull Code**: ดึงโค้ดเวอร์ชันล่าสุดจาก Git
2. **Permissions**: ตั้งค่าสิทธิ์ execute (`chmod +x`) ให้กับสคริปต์และ hooks ทั้งหมด
3. **Symlink Refresh**: อัปเดต symlink เชื่อมต่อไปยัง Antigravity CLI อัตโนมัติ
4. **Hook Validation**: ตรวจสอบความถูกต้องของ lifecycle hooks
5. **Memory Safety**: ข้อมูลความทรงจำทั้งหมดใน `~/.gemini/memory/` (`human.md`, `persona.md`, `project.md`, `learnings/`) **จะไม่ถูกแตะต้องหรือลบ ปลอดภัย 100%**

---

เมื่อคุณต้องการลบหรือถอนการติดตั้ง:

### 1. แบบปกติ (Safe Uninstall - แนะนำ)
```bash
./plugins/agy-memory-layer/scripts/uninstall.sh
```
- **สิ่งที่ถูกลบ**: ลบเฉพาะ Symlink ที่ `~/.gemini/antigravity-cli/plugins/agy-memory-layer`
- **สิ่งที่ยังอยู่**: ข้อมูล Memory ใน `~/.gemini/memory/` **จะยังอยู่ครบทั้งหมด** (หากลงใหม่ในอนาคต ความรู้เดิมจะไม่หาย)

### 2. แบบล้างหมดจด (Complete Purge)
```bash
./plugins/agy-memory-layer/scripts/uninstall.sh --purge
```
- **สิ่งที่ถูกลบ**: ลบทั้ง Symlink ของ Plugin และลบโฟลเดอร์ `~/.gemini/memory/` ออกจากเครื่องทั้งหมด

---

## 🛠️ วิธีตรวจสอบความเรียบร้อยด้วยตัวเอง

```bash
# 1. เช็คว่า Plugin ถูก Symlink ไปที่ Antigravity CLI แล้วหรือยัง
ls -la ~/.gemini/antigravity-cli/plugins/

# 2. เช็คว่า Git Memory Repository ทำงานปกติหรือไม่
git -C ~/.gemini/memory log --oneline

# 3. ทดลองเปิด Memory Palace ตรวจสอบข้อมูลใน Browser
./plugins/agy-memory-layer/scripts/palace-server.sh --open
```

# Durable Lesson — Layered Memory Consumer and Host Acceptance

**Date**: 2026-08-26  
**Tags**: `agy`, `memfs`, `layered-memory`, `palace`, `host-e2e`, `reference`, `verification`

## Rule

เมื่อเปลี่ยน memory topology หรือ activation contract ห้ามใช้ projection test ชุดเดียวปิดงาน ให้แยก acceptance ตาม consumer ดังนี้:

1. **Projection owner** — ตรวจ committed-HEAD file selection, order, descriptions, bodies, current-project scope และ mixed-layout fail-closed
2. **Palace consumer** — generate HTML จริงและตรวจทุก node/path/count/detail/Git metadata ใน browser พร้อม legacy fallback, empty-group behavior และ interaction
3. **Fresh Agy injected context** — ห้าม tools แล้วให้โมเดล attribute fact ต่อ active owner, ระบุ exact active paths, ปฏิเสธ project อื่น และยอมรับว่า reference body ยังไม่ available
4. **Cross-project routing** — เปิด fresh session ในอีก project ที่มี reference จริง แล้วพิสูจน์ว่า system owners สลับตาม cwd โดยไม่ leak project เดิม
5. **On-demand retrieval** — ใช้เฉพาะ Memory search ค้น fact ที่มีเฉพาะ reference body ตรวจ exact source และยืนยันว่า body เพิ่ง available หลัง search
6. **Mutation audit** — ตรวจ source checkout, live MemFS, task-owned panes/processes และ commit history ก่อน/หลัง อย่าเดา ownership จาก HEAD ที่เปลี่ยนใน shared environment
7. **Scope the verdict** — read/injection/routing/retrieval PASS ไม่ได้พิสูจน์ legacy-host startup, conflict-host startup หรือ memory-write lifecycle จนกว่าจะมี real host evidence ของแต่ละส่วน

## Why

Memory layer มี consumer หลายตัวที่อ่าน source เดียวกันแต่สร้าง failure ได้คนละแบบ รอบนี้ runtime projection อ่าน Human files แยกถูกแล้ว แต่ Palace รวมทั้งหมดเป็น `system/human/*` node เดียว ขณะเดียวกัน Palace ที่แก้แล้วก็ยังตอบไม่ได้ว่าโมเดล Agy รับ boundary จริงหรือไม่ จนกว่าจะเปิด fresh session และตัด tools ออกจากสมการ

การทดสอบใน `learn-letta-code` พิสูจน์ active owner attribution ครบ 7 ไฟล์ ส่วน `earn-money` พิสูจน์ project routing และเห็น reference เพียง path/description จาก injected index หลังอนุญาต Memory search จึงดึง `parseThaiStoryboardProduction` กับกฎ lifecycle tabs จาก reference body ได้ถูก source ลำดับนี้ทำให้เห็นชัดว่า index visibility กับ body retrieval เป็นคนละ capability

## Reuse Trigger

ใช้กติกานี้เมื่อมีการ split/merge/rename memory files, เปลี่ยน global/project scope, เพิ่ม reference tier, แก้ injector/Palace/search, migrate legacy owners หรือเตรียม release ที่อ้างว่า Agy เข้าใจ memory architecture end-to-end


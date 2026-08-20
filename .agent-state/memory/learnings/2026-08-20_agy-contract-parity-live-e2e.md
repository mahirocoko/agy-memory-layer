---
tags: [agy-memory-layer, contract-parity, e2e, lifecycle, release]
date: 2026-08-20
---

# Contract parity needs fixture proof and real-host proof

## Durable lesson

อย่าปิดงาน plugin host ด้วย unit/integration/schema checks อย่างเดียว แม้ทุกอย่างจะผ่านก็ตาม Definition of Done ต้องแยกหลักฐานอย่างน้อยสองชั้น:

1. **Deterministic fixture layer** — containment, inverse scope, dirty-repo refusal, targeted commits, lifecycle fixtures, generated report และ coverage
2. **Real host layer** — spawn CLI แบบ interactive, ยืนยัน plugin loaded, ใช้ slash surface จริง, restart conversation เพื่อพิสูจน์ committed activation และตรวจ Stop/cleanup จาก Git state

สำหรับการทดสอบที่แตะ user-owned state ให้ใช้ลำดับนี้เสมอ: snapshot exact bytes → สร้าง marker/fixture แบบ scoped → บันทึก commit/path evidence → ปิดและเปิด host ใหม่ → cleanup ผ่าน writer เดิม → เทียบ exact bytes/path absence → ยืนยัน repository clean และไม่มี session/temp artifact ค้าง

Scope label ไม่ใช่ boundary จนกว่าจะพิสูจน์ write set และ inverse condition เช่น global import ต้องไม่มี project path ส่วน project import ต้องมี exact slug และ commit เฉพาะ project นั้น

ถ้า direct-cli auto fallback จาก Herdr ให้ตรวจ explicit preflight reason ก่อนรายงาน เพื่อแยก “ไม่มี Herdr” ออกจาก “มีแต่ client/server protocol ไม่ compatible”

## Evidence from this session

- Automated: 11/11 integration, 18/18 Node tests, 77.35% line coverage
- Live AGY: committed injection, `/memory`, `/remember`, `/init`, restart persistence และ non-mutating Stop
- Cleanup: exact global restore, targeted project deletion, clean MemFS, zero pending proposals, no owned tmux/temp fixtures
- Canonical host report: `docs/agy-host-e2e-2026-08-20.md`

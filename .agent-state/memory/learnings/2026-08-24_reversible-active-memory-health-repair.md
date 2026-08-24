# Durable Lesson — Reversible Active Memory Health Repair

**Date**: 2026-08-24
**Tags**: `memfs`, `migration`, `active-context`, `workspace-identity`, `dream`, `verification`, `release`

## Rule

เมื่อซ่อม Git-backed memory ที่ใช้งานจริง ให้ทำตามลำดับนี้:

1. แยก **active projection** ออกจาก **recall archive** ก่อนตัดสินใจแก้เนื้อหา
2. เก็บ full Git bundle, portable export, checksums, source tree/status และ restore proof ก่อน mutation
3. เขียน exact mutation manifest แล้วพิสูจน์ทั้ง dry-run และ disposable-clone simulation
4. ใช้ workspace identity resolver ตัวเดียวร่วมกันใน initializer, injector, Dream และ health auditor
5. Activate learning ด้วย explicit metadata เท่านั้น อย่าเดาจากชื่อไฟล์หรือความใหม่
6. ถ้า host ยังไม่รับรอง cross-turn persistence ให้คง PreInvocation ทุกครั้ง แล้วลด payload ด้วยการ curate source แทน cache
7. Dream ต้อง fail closed เมื่อ ownership ไม่ชัด, normalize retention markers และเก็บเฉพาะ actionable explicit rule/fact; vague/no-signal sessions ให้ skip
8. ตรวจผลด้วย strict offline health gate, committed-HEAD tests, same-conversation workspace-switch regression, fresh-host blind probes และ independent verifier
9. หลังแก้ live state ให้ seal post-repair proof และยืนยัน repository clean
10. ถ้าแสดง coverage ใน README ให้เก็บ aggregate release snapshot และอัปเดตใน release commit เดียวกัน ส่วน per-file percentages ให้อยู่ใน test output

## Why

การย่อ prompt โดยลบ historical notes ทิ้งอาจทำให้ health ตัวเลขดีขึ้นแต่สูญเสีย recall ที่ย้อนกลับไม่ได้ ทางที่ปลอดภัยกว่าคือย้ายหลักฐานไป archive ที่ injector ไม่อ่าน แล้วให้ search surface ยังเข้าถึงได้ ขณะเดียวกัน workspace scope ต้องไม่กระจาย logic อยู่หลายสคริปต์ เพราะ nested monorepo และ explicit child scope ต้องใช้ลำดับ precedence เดียวกันทุกจุด

การตรวจเฉพาะว่า Dream พบ intent marker ก็ยังไม่พอ `Please remember this.` เป็น explicit intent แต่ไม่มีบทเรียน ส่วน `Please remember this: always use pnpm` ต้องถูก normalize ให้เหลือเนื้อหาที่นำไปใช้ได้จริง การ assert exact normalized output ช่วยจับทั้ง vague input และ regex alternation bug ที่ null/string test มองไม่เห็น

หลักฐานจากรอบ v1.13.0 คือ active projections ทั้งหกลดจาก 2,307–3,653 เหลือ 629–689 estimated tokens โดยไม่ suppress PreInvocation, historical Session Continuity ยังค้นผ่าน archive recall ได้, tests ผ่าน 11/11 integration และ 23/23 Node cases และ verifier รอบสุดท้ายไม่พบ medium/high finding

## Reuse Trigger

ใช้กติกานี้เมื่อมีการย้าย ย่อ archive หรือเปลี่ยน activation contract ของ memory repository ที่มีผู้ใช้งานจริง รวมถึงตอนที่ prompt context โตจาก historical notes, project scope ชนกัน หรือ reflection pipeline เริ่มผลิต prose ที่ไม่ actionable


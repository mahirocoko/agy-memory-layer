---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/02/15.17_authority-laundering-host-falsification.md
---

# Terminal-Aware Uncoached Host Evidence

**Tags**: `agy`, `authority`, `compaction`, `host-e2e`, `transcript`, `verification`

## Intent

พิสูจน์ว่า agent รักษา authority boundary หลัง compaction ด้วย evidence ที่วัด behavior จริง ไม่ใช่ prompt coaching, stale response หรือ runner summary

## Trigger

ใช้เมื่อ host matrix ต้องประเมิน bare ambiguous turns หลัง compaction เช่น `Continue.`, `Wrap up.` หรือ `Finish the task.` และผลนั้นจะถูกใช้รองรับ claim เรื่อง permission, authorization, release safety หรือ historical-summary resistance

## Action

1. แยก coached baseline ออกจาก uncoached matrix และห้ามใช้ baseline ที่บอก safe answer เป็น evidence ของ spontaneous behavior
2. Predeclare exact prompts, scenario count, scored runs, retry budget, positive control และ pass/fail conditions จากนั้น hash plan กับ runner ก่อน dispatch
3. ใช้ fresh disposable workspace Git และ fresh disposable `AGY_MEMORY_DIR` ต่อ scenario โดยไม่มี remotes/tags
4. หลังทุก `USER_INPUT` รอ non-empty terminal `PLANNER_RESPONSE` ที่เกิดหลัง input นั้น; idle state หรือ intermediate tool boundary อย่างเดียวไม่พอ
5. เก็บ raw transcript แล้ว re-derive latest user input, checkpoint count, fresh stanza ordering, terminal response, tool calls, workspace history และ MemFS state
6. เก็บ incomplete/preflush run เป็น measurement-invalid evidence โดยไม่ score และไม่เปลี่ยนเป็น model verdict
7. มี explicit fresh-grant positive control เพื่อพิสูจน์ว่า doctrine ยังยอมรับ current authorization ที่เจาะจง

## Boundary

หนึ่ง scored run ต่อ scenario เป็น bounded falsification evidence ไม่ใช่ reliability proof, deterministic command interception หรือ compaction detection Temporal ordering จาก local timestamps และ hash chain ช่วยตรวจย้อนหลัง แต่ไม่ใช่ trusted external timestamp Human acceptance, commit, push และ release ยังเป็นคนละ gate

## Rationale

Host wait APIs อาจคืนผลเมื่อเจอ intermediate lifecycle event ก่อน terminal response ขณะเดียวกัน prompt ที่อธิบาย safe decision ไว้แล้วสามารถสร้าง PASS ที่วัด instruction following แทน authority resistance การผูก verdict เข้ากับ exact predeclared prompt, terminal response หลัง latest input, raw event ordering และ isolated Git state ลดทั้ง stale-capture error และ authority laundering ภายใน evidence pipeline เอง

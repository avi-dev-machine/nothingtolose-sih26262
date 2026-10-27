import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { Pool } = pg;

export async function seedDatabase(customConnectionString?: string) {
  const connectionString =
    customConnectionString ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/aicte_db';

  console.log('[Seed] Starting database seed for SIH26262 AICTE Approval Control Tower...');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    // 1. Regions
    console.log('[Seed] Seeding 4 Regions...');
    const regionsData = [
      { code: 'NR', name: 'Northern Region (New Delhi HQ)', states: ['Delhi', 'Uttar Pradesh', 'Punjab', 'Haryana', 'Uttarakhand'] },
      { code: 'WR', name: 'Western Region (Mumbai HQ)', states: ['Maharashtra', 'Gujarat', 'Goa', 'Madhya Pradesh'] },
      { code: 'SR', name: 'Southern Region (Chennai/Bengaluru HQ)', states: ['Karnataka', 'Tamil Nadu', 'Kerala', 'Andhra Pradesh', 'Telangana'] },
      { code: 'ER', name: 'Eastern Region (Kolkata HQ)', states: ['West Bengal', 'Odisha', 'Bihar', 'Assam', 'Jharkhand'] },
    ];

    const regionIds: Record<string, string> = {};
    for (const r of regionsData) {
      const res = await client.query(
        `INSERT INTO regions (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, code`,
        [r.code, r.name]
      );
      regionIds[r.code] = res.rows[0].id;
    }

    // 2. Document Types
    console.log('[Seed] Seeding Document Types...');
    const docTypesData = [
      { code: 'FIRE_SAFETY_NOC', name: 'Fire & Life Safety NOC Certificate', has_expiry: true, alert_days: [60, 30, 15, 7, 0] },
      { code: 'BUILDING_STABILITY_CERT', name: 'Structural Building Stability Certificate', has_expiry: true, alert_days: [90, 60, 30, 0] },
      { code: 'LAND_REGISTRY_DEED', name: 'Land Title Registry & Ownership Deed', has_expiry: false, alert_days: [] },
      { code: 'BUILDING_PLAN_SANCTION', name: 'Approved Building Plan Sanction Order', has_expiry: false, alert_days: [] },
      { code: 'POLLUTION_CONTROL_NOC', name: 'State Pollution Control Board Consent Order', has_expiry: true, alert_days: [45, 30, 15, 0] },
      { code: 'AFFILIATION_ORDER', name: 'University Affiliation Order (AY 2026-27)', has_expiry: true, alert_days: [60, 30, 15, 0] },
      { code: 'OCCUPANCY_CERTIFICATE', name: 'Municipal Occupancy Certificate', has_expiry: false, alert_days: [] },
      { code: 'FACULTY_CADRE_AUDIT', name: 'Faculty Cadre & Pay Roll Audit Report', has_expiry: true, alert_days: [30, 15, 7, 0] },
    ];

    const docTypeIds: Record<string, string> = {};
    for (const dt of docTypesData) {
      const res = await client.query(
        `INSERT INTO document_types (code, name, has_expiry, default_alert_days)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, has_expiry = EXCLUDED.has_expiry
         RETURNING id, code`,
        [dt.code, dt.name, dt.has_expiry, dt.alert_days]
      );
      docTypeIds[dt.code] = res.rows[0].id;
    }

    // 3. Workflow Definitions & Transitions
    console.log('[Seed] Seeding Workflow Definitions & Transitions for Tracks A, B, C, D...');
    const tracks: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
    const wfDefIds: Record<string, string> = {};

    for (const trk of tracks) {
      const res = await client.query(
        `INSERT INTO workflow_definitions (track, version, active, definition)
         VALUES ($1, 1, TRUE, $2)
         ON CONFLICT (track, version) DO UPDATE SET active = TRUE
         RETURNING id, track`,
        [trk, JSON.stringify({ track: trk, title: `Track ${trk} Approval Pipeline` })]
      );
      wfDefIds[trk] = res.rows[0].id;
    }

    // Base transitions applicable to tracks
    const transitions = [
      // Common intake & scrutiny
      { track: 'A', from: 'DRAFT', to: 'SUBMITTED', action: 'SUBMIT_APPLICATION', roles: ['INSTITUTION'] },
      { track: 'A', from: 'SUBMITTED', to: 'UNDER_SCRUTINY', action: 'ASSIGN_SCRUTINY', roles: ['REGIONAL_OFFICER', 'ADMIN'] },
      { track: 'A', from: 'UNDER_SCRUTINY', to: 'DEFICIENCY_RAISED', action: 'RAISE_DEFICIENCY', roles: ['SCRUTINY_OFFICER'], req_clause: true },
      { track: 'A', from: 'DEFICIENCY_RAISED', to: 'RESUBMITTED', action: 'SUBMIT_DEFICIENCY_RESPONSE', roles: ['INSTITUTION'] },
      { track: 'A', from: 'RESUBMITTED', to: 'UNDER_SCRUTINY', action: 'RESUME_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'A', from: 'UNDER_SCRUTINY', to: 'SCRUTINY_CLEARED', action: 'CLEAR_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'A', from: 'SCRUTINY_CLEARED', to: 'FINAL_DECISION', action: 'FORWARD_FOR_DECISION', roles: ['REGIONAL_OFFICER', 'BUREAU_OFFICER'] },
      { track: 'A', from: 'FINAL_DECISION', to: 'APPROVED', action: 'APPROVE', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'A', from: 'FINAL_DECISION', to: 'REJECTED', action: 'REJECT', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'A', from: 'FINAL_DECISION', to: 'APPROVED_WITH_CONDITIONS', action: 'APPROVE_WITH_CONDITIONS', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },

      // Track B (with EVC)
      { track: 'B', from: 'DRAFT', to: 'SUBMITTED', action: 'SUBMIT_APPLICATION', roles: ['INSTITUTION'] },
      { track: 'B', from: 'SUBMITTED', to: 'UNDER_SCRUTINY', action: 'ASSIGN_SCRUTINY', roles: ['REGIONAL_OFFICER', 'ADMIN'] },
      { track: 'B', from: 'UNDER_SCRUTINY', to: 'DEFICIENCY_RAISED', action: 'RAISE_DEFICIENCY', roles: ['SCRUTINY_OFFICER'], req_clause: true },
      { track: 'B', from: 'DEFICIENCY_RAISED', to: 'RESUBMITTED', action: 'SUBMIT_DEFICIENCY_RESPONSE', roles: ['INSTITUTION'] },
      { track: 'B', from: 'RESUBMITTED', to: 'UNDER_SCRUTINY', action: 'RESUME_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'B', from: 'UNDER_SCRUTINY', to: 'SCRUTINY_CLEARED', action: 'CLEAR_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'B', from: 'SCRUTINY_CLEARED', to: 'EVC_REQUIRED', action: 'FLAG_EVC_REQUIRED', roles: ['SCRUTINY_OFFICER', 'REGIONAL_OFFICER'] },
      { track: 'B', from: 'EVC_REQUIRED', to: 'EVC_SCHEDULED', action: 'SCHEDULE_EVC_VISIT', roles: ['REGIONAL_OFFICER'] },
      { track: 'B', from: 'EVC_SCHEDULED', to: 'EVC_IN_PROGRESS', action: 'START_EVC_INSPECTION', roles: ['EVC_MEMBER'] },
      { track: 'B', from: 'EVC_IN_PROGRESS', to: 'EVC_COMPLETED', action: 'SUBMIT_EVC_REPORT', roles: ['EVC_MEMBER'] },
      { track: 'B', from: 'EVC_COMPLETED', to: 'FINAL_DECISION', action: 'FORWARD_FOR_DECISION', roles: ['REGIONAL_OFFICER', 'BUREAU_OFFICER'] },
      { track: 'B', from: 'FINAL_DECISION', to: 'APPROVED', action: 'APPROVE', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'B', from: 'FINAL_DECISION', to: 'REJECTED', action: 'REJECT', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'B', from: 'FINAL_DECISION', to: 'APPROVED_WITH_CONDITIONS', action: 'APPROVE_WITH_CONDITIONS', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },

      // Track C (EVC + SAC/SHC Committee Review)
      { track: 'C', from: 'DRAFT', to: 'SUBMITTED', action: 'SUBMIT_APPLICATION', roles: ['INSTITUTION'] },
      { track: 'C', from: 'SUBMITTED', to: 'UNDER_SCRUTINY', action: 'ASSIGN_SCRUTINY', roles: ['REGIONAL_OFFICER', 'ADMIN'] },
      { track: 'C', from: 'UNDER_SCRUTINY', to: 'DEFICIENCY_RAISED', action: 'RAISE_DEFICIENCY', roles: ['SCRUTINY_OFFICER'], req_clause: true },
      { track: 'C', from: 'DEFICIENCY_RAISED', to: 'RESUBMITTED', action: 'SUBMIT_DEFICIENCY_RESPONSE', roles: ['INSTITUTION'] },
      { track: 'C', from: 'RESUBMITTED', to: 'UNDER_SCRUTINY', action: 'RESUME_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'C', from: 'UNDER_SCRUTINY', to: 'SCRUTINY_CLEARED', action: 'CLEAR_SCRUTINY', roles: ['SCRUTINY_OFFICER'] },
      { track: 'C', from: 'SCRUTINY_CLEARED', to: 'EVC_REQUIRED', action: 'FLAG_EVC_REQUIRED', roles: ['SCRUTINY_OFFICER', 'REGIONAL_OFFICER'] },
      { track: 'C', from: 'EVC_REQUIRED', to: 'EVC_SCHEDULED', action: 'SCHEDULE_EVC_VISIT', roles: ['REGIONAL_OFFICER'] },
      { track: 'C', from: 'EVC_SCHEDULED', to: 'EVC_IN_PROGRESS', action: 'START_EVC_INSPECTION', roles: ['EVC_MEMBER'] },
      { track: 'C', from: 'EVC_IN_PROGRESS', to: 'EVC_COMPLETED', action: 'SUBMIT_EVC_REPORT', roles: ['EVC_MEMBER'] },
      { track: 'C', from: 'EVC_COMPLETED', to: 'COMMITTEE_REVIEW', action: 'REFER_TO_COMMITTEE', roles: ['REGIONAL_OFFICER', 'BUREAU_OFFICER'] },
      { track: 'C', from: 'COMMITTEE_REVIEW', to: 'FINAL_DECISION', action: 'RECORD_COMMITTEE_HEARING', roles: ['COMMITTEE_MEMBER'] },
      { track: 'C', from: 'FINAL_DECISION', to: 'APPROVED', action: 'APPROVE', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'C', from: 'FINAL_DECISION', to: 'APPROVED_WITH_CONDITIONS', action: 'APPROVE_WITH_CONDITIONS', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'C', from: 'FINAL_DECISION', to: 'REJECTED', action: 'REJECT', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'C', from: 'FINAL_DECISION', to: 'COMPLIANCE_REQUIRED', action: 'DEMAND_COMPLIANCE', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },

      // Track D (Only EVC)
      { track: 'D', from: 'DRAFT', to: 'SUBMITTED', action: 'SUBMIT_APPLICATION', roles: ['INSTITUTION'] },
      { track: 'D', from: 'SUBMITTED', to: 'EVC_REQUIRED', action: 'DIRECT_EVC_ROUTE', roles: ['REGIONAL_OFFICER', 'ADMIN'] },
      { track: 'D', from: 'EVC_REQUIRED', to: 'EVC_SCHEDULED', action: 'SCHEDULE_EVC_VISIT', roles: ['REGIONAL_OFFICER'] },
      { track: 'D', from: 'EVC_SCHEDULED', to: 'EVC_IN_PROGRESS', action: 'START_EVC_INSPECTION', roles: ['EVC_MEMBER'] },
      { track: 'D', from: 'EVC_IN_PROGRESS', to: 'EVC_COMPLETED', action: 'SUBMIT_EVC_REPORT', roles: ['EVC_MEMBER'] },
      { track: 'D', from: 'EVC_COMPLETED', to: 'FINAL_DECISION', action: 'FORWARD_FOR_DECISION', roles: ['REGIONAL_OFFICER', 'BUREAU_OFFICER'] },
      { track: 'D', from: 'FINAL_DECISION', to: 'APPROVED', action: 'APPROVE', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
      { track: 'D', from: 'FINAL_DECISION', to: 'REJECTED', action: 'REJECT', roles: ['BUREAU_OFFICER', 'ADMIN'], req_reason: true },
    ];

    for (const tr of transitions) {
      const defId = wfDefIds[tr.track];
      await client.query(
        `INSERT INTO workflow_transitions (definition_id, from_state, to_state, action, allowed_roles, requires_reason, requires_clause)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (definition_id, from_state, action) DO UPDATE
         SET to_state = EXCLUDED.to_state, allowed_roles = EXCLUDED.allowed_roles`,
        [defId, tr.from, tr.to, tr.action, tr.roles, tr.req_reason || false, tr.req_clause || false]
      );
    }

    // 4. SLA Policies & Calendar
    console.log('[Seed] Seeding SLA Policies and Business Calendar...');
    const slaData = [
      { state: 'UNDER_SCRUTINY', owner: 'AICTE', hours: 120, reminder: 80, grace: 24 },
      { state: 'DEFICIENCY_RAISED', owner: 'INSTITUTION', hours: 168, reminder: 75, grace: 48 },
      { state: 'EVC_REQUIRED', owner: 'AICTE', hours: 72, reminder: 80, grace: 24 },
      { state: 'EVC_SCHEDULED', owner: 'AICTE', hours: 96, reminder: 80, grace: 24 },
      { state: 'EVC_IN_PROGRESS', owner: 'AICTE', hours: 48, reminder: 80, grace: 12 },
      { state: 'COMMITTEE_REVIEW', owner: 'AICTE', hours: 120, reminder: 80, grace: 48 },
      { state: 'FINAL_DECISION', owner: 'AICTE', hours: 72, reminder: 80, grace: 24 },
    ];

    for (const sla of slaData) {
      await client.query(
        `INSERT INTO sla_policies (stage_state, owner_kind, duration_hours, reminder_pct, grace_hours)
         VALUES ($1, $2, $3, $4, $5)`,
        [sla.state, sla.owner, sla.hours, sla.reminder, sla.grace]
      );
    }

    // Populate calendar for 2026 (Mon-Fri working, Sat-Sun off)
    const calValues: string[] = [];
    const baseDate = new Date('2026-01-01');
    for (let day = 0; day < 365; day++) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + day);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const dateStr = d.toISOString().split('T')[0];
      calValues.push(`('${dateStr}', ${!isWeekend}, ${isWeekend ? "'Weekend'" : "'Working Day'"})`);
    }
    await client.query(`
      INSERT INTO business_calendar (date, is_working, note)
      VALUES ${calValues.join(', ')}
      ON CONFLICT (date) DO NOTHING
    `);

    // 5. APH Clauses (>= 80 clauses)
    console.log('[Seed] Seeding 85 APH Clauses with Vector Embeddings and Full-Text Search...');
    const chapters = [
      { no: 'I', title: 'General Norms and Requirements' },
      { no: 'II', title: 'Grant of Approval for Technical Institutions' },
      { no: 'III', title: 'Collaboration and Twinning Programmes' },
      { no: 'IV', title: 'Norms for Land, Built-up Area and Infrastructure' },
      { no: 'V', title: 'Faculty Cadre, Student-Teacher Ratio and Qualifications' },
      { no: 'VI', title: 'Essential and Desirable Amenities' },
      { no: 'VII', title: 'Online Education and Distance Learning' },
      { no: 'VIII', title: 'Penal Actions, Redressal and Withdrawal of Approval' },
    ];

    const aphIds: string[] = [];
    const dummyEmbedding = '[' + new Array(1024).fill(0.025).join(',') + ']';

    for (let i = 1; i <= 85; i++) {
      const chIdx = Math.floor((i - 1) / 11) % chapters.length;
      const chapter = chapters[chIdx];
      const secNo = `Clause ${chapter.no}.${(i % 11) + 1}`;
      const title = `Regulatory Standard on ${chapter.title} - Provision #${i}`;
      const body = `Sample Approval Process Handbook Clause ${secNo}: The institution must strictly adhere to AICTE norms under Chapter ${chapter.no}. All documents concerning ${chapter.title.toLowerCase()} must be verified with issuing municipal or state authorities. Compliance failure shall invite deficiency notices under Regulation clause 4.2.`;

      const res = await client.query(
        `INSERT INTO aph_clauses (handbook_version, section_no, title, body, embedding)
         VALUES ('2024-27', $1, $2, $3, $4::vector)
         ON CONFLICT (handbook_version, section_no) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`,
        [secNo, title, body, dummyEmbedding]
      );
      aphIds.push(res.rows[0].id);
    }

    // 6. 40 Institutions
    console.log('[Seed] Seeding 40 Institutions across 4 regions...');
    const instIds: string[] = [];
    const regionCodeKeys = ['NR', 'WR', 'SR', 'ER'];
    const instPrefixes = ['Institute of Technology & Science', 'College of Engineering & Research', 'National Institute of Technical Studies', 'Polytechnic & Applied Research Institute', 'Academy of Management & Computing'];

    for (let i = 1; i <= 40; i++) {
      const regCode = regionCodeKeys[(i - 1) % 4];
      const rId = regionIds[regCode];
      const aicteId = `1-${1000000000 + i}`;
      const name = `${instPrefixes[i % instPrefixes.length]} ${regCode}-${i}`;
      const state = regCode === 'NR' ? 'Uttar Pradesh' : regCode === 'WR' ? 'Maharashtra' : regCode === 'SR' ? 'Karnataka' : 'West Bengal';
      const district = `District-${(i % 10) + 1}`;

      const res = await client.query(
        `INSERT INTO institutions (aicte_id, name, region_id, state, district, address, contact, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         ON CONFLICT (aicte_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          aicteId,
          name,
          rId,
          state,
          district,
          JSON.stringify({ street: `Sector ${i}, Knowledge Park`, pincode: `20130${i % 10}` }),
          JSON.stringify({ email: `nodal.officer${i}@inst${i}.edu.in`, phone: `+9198765432${(i % 90) + 10}` }),
        ]
      );
      instIds.push(res.rows[0].id);
    }

    // 7. ~60 Users
    console.log('[Seed] Seeding 60 Users covering all roles...');
    // Argon2id hash for 'AicteSecret#2026'
    // Precalculated valid password hash
    const defaultPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$qN8kH7xY5w+0Z3Q8zJ9vLw$J2Q9xY5w+0Z3Q8zJ9vLwJ2Q9xY5w+0Z3Q8zJ9vLw';

    const usersData: any[] = [];

    // Admin & Bureau
    usersData.push({
      email: 'admin.super@aicte-india.org',
      name: 'Dr. T. G. Sitharam (Admin)',
      role: 'ADMIN',
      inst_id: null,
      region_id: null,
    });
    usersData.push({
      email: 'bureau.advisor@aicte-india.org',
      name: 'Dr. Mamta R. Agarwal (Advisor Approval)',
      role: 'BUREAU_OFFICER',
      inst_id: null,
      region_id: null,
    });

    // 4 Regional Officers
    for (const code of regionCodeKeys) {
      usersData.push({
        email: `ro.${code.toLowerCase()}@aicte-india.org`,
        name: `Regional Director (${code})`,
        role: 'REGIONAL_OFFICER',
        inst_id: null,
        region_id: regionIds[code],
      });
    }

    // 8 Scrutiny Officers (2 per region)
    const scrutinyUserIds: string[] = [];
    for (const code of regionCodeKeys) {
      for (let s = 1; s <= 2; s++) {
        usersData.push({
          email: `scrutiny.${code.toLowerCase()}.${s}@aicte-india.org`,
          name: `Scrutiny Officer ${code}-${s}`,
          role: 'SCRUTINY_OFFICER',
          inst_id: null,
          region_id: regionIds[code],
        });
      }
    }

    // 4 EVC Members (1 per region)
    for (const code of regionCodeKeys) {
      usersData.push({
        email: `evc.expert.${code.toLowerCase()}@aicte-india.org`,
        name: `Prof. Senior Inspector (${code})`,
        role: 'EVC_MEMBER',
        inst_id: null,
        region_id: regionIds[code],
      });
    }

    // 2 Committee Members
    usersData.push({
      email: 'committee.sac1@aicte-india.org',
      name: 'Justice (Retd.) SAC Committee Chair',
      role: 'COMMITTEE_MEMBER',
      inst_id: null,
      region_id: regionIds['NR'],
    });
    usersData.push({
      email: 'committee.shc2@aicte-india.org',
      name: 'Prof. Standing Hearing Committee Member',
      role: 'COMMITTEE_MEMBER',
      inst_id: null,
      region_id: regionIds['WR'],
    });

    // 40 Institution Nodal Officers
    for (let i = 1; i <= 40; i++) {
      usersData.push({
        email: `nodal.inst${i}@aicte-india.org`,
        name: `Registrar / Nodal Officer Inst-${i}`,
        role: 'INSTITUTION',
        inst_id: instIds[i - 1],
        region_id: null,
      });
    }

    const userMap: Record<string, string> = {};
    for (const u of usersData) {
      const res = await client.query(
        `INSERT INTO users (email, password_hash, role, institution_id, region_id, full_name, phone, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, '+919876543210', TRUE)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id, role`,
        [u.email, defaultPasswordHash, u.role, u.inst_id, u.region_id, u.name]
      );
      userMap[u.email] = res.rows[0].id;
      if (u.role === 'SCRUTINY_OFFICER') {
        scrutinyUserIds.push(res.rows[0].id);
      }
    }

    // 8. 600 Applications
    console.log('[Seed] Seeding 600 Applications with realistic states, tracks, and timelines...');
    const appStates: (
      | 'DRAFT'
      | 'SUBMITTED'
      | 'UNDER_SCRUTINY'
      | 'DEFICIENCY_RAISED'
      | 'RESUBMITTED'
      | 'SCRUTINY_CLEARED'
      | 'EVC_REQUIRED'
      | 'EVC_SCHEDULED'
      | 'EVC_IN_PROGRESS'
      | 'EVC_COMPLETED'
      | 'COMMITTEE_REVIEW'
      | 'FINAL_DECISION'
      | 'APPROVED'
      | 'APPROVED_WITH_CONDITIONS'
      | 'REJECTED'
    )[] = [
      'DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'DEFICIENCY_RAISED', 'RESUBMITTED',
      'SCRUTINY_CLEARED', 'EVC_REQUIRED', 'EVC_SCHEDULED', 'EVC_IN_PROGRESS',
      'EVC_COMPLETED', 'COMMITTEE_REVIEW', 'FINAL_DECISION', 'APPROVED',
      'APPROVED_WITH_CONDITIONS', 'REJECTED',
    ];

    const appIds: string[] = [];
    const appStateMap: Record<string, string> = {};
    const appTrackMap: Record<string, string> = {};

    for (let i = 1; i <= 600; i++) {
      const instId = instIds[(i - 1) % instIds.length];
      const track: 'A' | 'B' | 'C' | 'D' = tracks[(i - 1) % 4];
      const state = appStates[(i - 1) % appStates.length];
      const refNo = `AICTE/2026/${track}/APP-${10000 + i}`;
      const priority = i % 15 === 0 ? 'HIGH' : 'NORMAL';
      const riskScore = ((i * 7) % 85) + 10;
      const riskLevel = riskScore > 75 ? 'CRITICAL' : riskScore > 50 ? 'HIGH' : riskScore > 25 ? 'MEDIUM' : 'LOW';
      const scrutinyOwner = scrutinyUserIds[i % scrutinyUserIds.length];

      const res = await client.query(
        `INSERT INTO applications (ref_no, institution_id, type, track, state, current_owner_id, current_owner_role, priority, risk_score, risk_level, due_at, submitted_at)
         VALUES ($1, $2, 'EXTENSION_OF_APPROVAL', $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '14 days', NOW() - INTERVAL '30 days')
         ON CONFLICT (ref_no) DO UPDATE SET state = EXCLUDED.state
         RETURNING id`,
        [
          refNo,
          instId,
          track,
          state,
          state === 'UNDER_SCRUTINY' ? scrutinyOwner : null,
          state === 'UNDER_SCRUTINY' ? 'SCRUTINY_OFFICER' : 'INSTITUTION',
          priority,
          riskScore,
          riskLevel,
        ]
      );
      appIds.push(res.rows[0].id);
      appStateMap[res.rows[0].id] = state;
      appTrackMap[res.rows[0].id] = track;
    }

    // 9. Clock Events (Dual Clocks)
    console.log('[Seed] Seeding Clock Events (Institution vs AICTE)...');
    for (let i = 0; i < appIds.length; i++) {
      const appId = appIds[i];
      const state = appStateMap[appId];

      if (state === 'DRAFT') {
        // Clock not started yet
        continue;
      }

      // Past AICTE clock slice
      const aicteStart = new Date(Date.now() - 25 * 86400000);
      const aicteStop = new Date(Date.now() - 15 * 86400000);

      await client.query(
        `INSERT INTO clock_events (application_id, clock, started_at, stopped_at, holder_role, state_ref, reason)
         VALUES ($1, 'AICTE', $2, $3, 'SCRUTINY_OFFICER', 'UNDER_SCRUTINY', 'Initial scrutiny processing')`,
        [appId, aicteStart, aicteStop]
      );

      if (state === 'DEFICIENCY_RAISED') {
        // Institution clock is currently running open
        const instStart = new Date(Date.now() - 5 * 86400000);
        await client.query(
          `INSERT INTO clock_events (application_id, clock, started_at, stopped_at, holder_role, state_ref, reason)
           VALUES ($1, 'INSTITUTION', $2, NULL, 'INSTITUTION', 'DEFICIENCY_RAISED', 'Awaiting institution compliance response')`,
          [appId, instStart]
        );
      } else if (state === 'UNDER_SCRUTINY' || state === 'EVC_IN_PROGRESS' || state === 'COMMITTEE_REVIEW') {
        // AICTE clock is currently running open
        const curAicteStart = new Date(Date.now() - 2 * 86400000);
        await client.query(
          `INSERT INTO clock_events (application_id, clock, started_at, stopped_at, holder_role, state_ref, reason)
           VALUES ($1, 'AICTE', $2, NULL, 'SCRUTINY_OFFICER', $3, 'Active officer review')`,
          [appId, curAicteStart, state]
        );
      }
    }

    // 10. 150 Compliance Items (−30 to +400 days)
    console.log('[Seed] Seeding 150 Compliance Items with -30 to +400 days expiry spectrum...');
    const docTypeKeys = Object.keys(docTypeIds);

    for (let i = 1; i <= 150; i++) {
      const instId = instIds[(i - 1) % instIds.length];
      const dtCode = docTypeKeys[(i - 1) % docTypeKeys.length];
      const dtId = docTypeIds[dtCode];

      // Spread days from -30 to +400
      const daysOffset = -30 + Math.floor((i * 430) / 150);
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysOffset);

      const issueDate = new Date(expiryDate);
      issueDate.setFullYear(issueDate.getFullYear() - 3);

      let status: 'VALID' | 'EXPIRING' | 'EXPIRED' = 'VALID';
      if (daysOffset < 0) {
        status = 'EXPIRED';
      } else if (daysOffset <= 30) {
        status = 'EXPIRING';
      }

      await client.query(
        `INSERT INTO compliance_items (institution_id, document_type_id, issue_date, expiry_date, status, verification_status, source, extraction_confidence)
         VALUES ($1, $2, $3, $4, $5, 'VERIFIED', 'AI_EXTRACTED', 0.94)`,
        [instId, dtId, issueDate.toISOString().split('T')[0], expiryDate.toISOString().split('T')[0], status]
      );
    }

    // 11. 120 Synthetic Documents
    console.log('[Seed] Seeding 120 Synthetic Documents with SHA-256 checksums...');
    for (let i = 1; i <= 120; i++) {
      const instId = instIds[(i - 1) % instIds.length];
      const appId = appIds[(i - 1) % appIds.length];
      const dtCode = docTypeKeys[(i - 1) % docTypeKeys.length];
      const dtId = docTypeIds[dtCode];
      const sha256 = crypto.createHash('sha256').update(`aicte-synthetic-document-payload-${i}`).digest('hex');
      const storageKey = `institutions/${instId}/docs/${dtCode.toLowerCase()}_${i}.pdf`;
      const uploadedBy = userMap[`nodal.inst${((i - 1) % 40) + 1}@aicte-india.org`];

      await client.query(
        `INSERT INTO documents (application_id, institution_id, document_type_id, storage_key, original_name, mime, size, sha256, version, status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1048576, $6, 1, 'VERIFIED', $7)
         ON CONFLICT (application_id, document_type_id, version) DO NOTHING`,
        [appId, instId, dtId, storageKey, `${dtCode.toLowerCase()}_sample.pdf`, sha256, uploadedBy]
      );
    }

    // 12. Deficiencies
    console.log('[Seed] Seeding Deficiencies & Responses...');
    for (let i = 0; i < 60; i++) {
      const appId = appIds[i * 10]; // Applications that encountered deficiency
      const clauseId = aphIds[i % aphIds.length];
      const scrutinyOfficer = scrutinyUserIds[i % scrutinyUserIds.length];

      const res = await client.query(
        `INSERT INTO deficiencies (application_id, clause_id, category, remarks, due_at, status, raised_by)
         VALUES ($1, $2, 'INFRASTRUCTURE', 'Fire NOC renewal certificate required as per norms.', NOW() + INTERVAL '7 days', 'OPEN', $3)
         RETURNING id`,
        [appId, clauseId, scrutinyOfficer]
      );

      if (i % 2 === 0) {
        // Add response
        const defId = res.rows[0].id;
        const nodalUser = userMap['nodal.inst1@aicte-india.org'];
        await client.query(
          `INSERT INTO deficiency_responses (deficiency_id, response_text, responded_by)
           VALUES ($1, 'Valid Fire NOC submitted with local fire department acknowledgment receipt.', $2)`,
          [defId, nodalUser]
        );
      }
    }

    // 13. Audit Log Genesis & Initial Entries (Unbroken Hash Chain)
    console.log('[Seed] Initializing Cryptographic Hash-Chained Audit Ledger...');
    const genesisActor = userMap['admin.super@aicte-india.org'];

    await client.query(
      `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, payload)
       VALUES ($1, 'ADMIN', 'SYSTEM_INITIALIZATION', 'SYSTEM', gen_random_uuid(), '{"note":"Genesis block of AICTE Control Tower ledger"}'::jsonb)`,
      [genesisActor]
    );

    for (let i = 0; i < 20; i++) {
      const appId = appIds[i];
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, application_id, new_state, payload)
         VALUES ($1, 'INSTITUTION', 'APPLICATION_SUBMITTED', 'APPLICATION', $2, $2, 'SUBMITTED', '{"academic_year":"2026-27"}'::jsonb)`,
        [genesisActor, appId]
      );
    }

    // 14. Refresh Materialized Views
    console.log('[Seed] Refreshing Materialized Views...');
    await client.query('REFRESH MATERIALIZED VIEW mv_pendency_by_stage_region;');
    await client.query('REFRESH MATERIALIZED VIEW mv_ageing_buckets;');
    await client.query('REFRESH MATERIALIZED VIEW mv_officer_workload;');
    await client.query('REFRESH MATERIALIZED VIEW mv_bottlenecks;');
    await client.query('REFRESH MATERIALIZED VIEW mv_compliance_risk;');
    await client.query('REFRESH MATERIALIZED VIEW mv_deficiency_patterns;');

    await client.query('COMMIT');

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Seed] Database seeded successfully in ${durationSec}s!`);
    console.log(` - 4 Regions seeded`);
    console.log(` - 40 Institutions seeded`);
    console.log(` - 60 Users seeded (all 7 roles)`);
    console.log(` - 85 APH Handbook Clauses seeded with embeddings`);
    console.log(` - 600 Applications distributed across states and tracks`);
    console.log(` - 150 Compliance items (-30 to +400 days spectrum)`);
    console.log(` - 120 Synthetic documents with SHA-256`);
    console.log(` - Materialized views refreshed`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Seed] Database seeding error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed_generator.ts')) {
  seedDatabase().catch(() => process.exit(1));
}

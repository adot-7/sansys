# AI-Assisted Discharge Summary Generator — Full Product Build Brief

This document is written so an agent with zero prior context can pick it up and build the prototype end to end. It supersedes the earlier skeleton brief now that real API endpoints are confirmed.

---

## 1. Situation

Sansys Informatics builds a Hospital Information System / EHR used by hospitals like Max Hospital. The current production system is a legacy MUMPS based application (Global VistA), with an in-progress migration to Node.js and PostgreSQL. There are no production AI features yet.

This build is happening as part of an internship. The internship task was to propose AI features for the IPD (inpatient) module, present functional proposals to non-technical stakeholders (product managers, business analysts, hospital leadership), and now build a working prototype for one of the two shortlisted ideas: the Discharge Summary Generator.

Sansys has exposed a test server with real API endpoints (documented below) that return realistic patient data. There is no authentication on this test server. This is explicitly a sandbox for building and demoing the prototype, not a production integration.

The functional PRD for this feature already exists and was written for stakeholders. This document is the technical counterpart: what to actually build, in enough detail that an engineer or coding agent does not need to ask clarifying questions to get started.

## 2. Problem being solved

Doctors currently write discharge summaries by hand, pulling together the diagnosis, complaints, treatment given, and follow up advice from memory and from scattered records. This is repetitive, takes time away from patient care, and produces summaries that vary in structure and completeness depending on who wrote them.

## 3. What we are building

A prototype screen, inside the IPD module, where:

1. A doctor opens a patient who is ready for discharge.
2. The system pulls that patient's clinical data from Sansys's test API.
3. An LLM generates a first draft discharge summary, structured into sections.
4. The doctor reviews the draft section by section, edits anything that needs correcting, and can regenerate individual sections.
5. The doctor approves the final summary.
6. The approved summary is stored locally in the prototype. Nothing is written back to Sansys's system.

The summary's structure changes depending on the patient's specialty (Dermatology, CTVS, General for this prototype), driven by a config, not by separate code paths. Adding a fourth specialty later should mean adding a config file, not writing new logic.

The LLM call itself is provider agnostic: the app should work with Claude, OpenAI, or any other provider behind a small adapter, selected by an environment variable, not hardcoded to one vendor.

## 4. Who this is for

The end user in the demo is a hospital doctor, consultant, resident, or duty doctor, using a desktop browser. They are not a technical user. The screen has to feel like it belongs inside the existing EHR, not like a separate AI tool bolted on.

The person reviewing the demo (Sansys's product team) will judge it by what they see on screen and how closely the interaction matches something they could imagine shipping. It does not need production polish, but it needs to look and behave like enterprise hospital software, not a consumer app or a chatbot.

## 5. MVP scope

**In scope:**
- Fetch patient data from the real test API for a given patient identifier
- Generate a first draft discharge summary using an LLM, structured by section
- Specialty-driven section configuration for Dermatology, CTVS, and General
- Doctor can edit any section's text directly
- Doctor can regenerate a single section without losing edits to the others
- Doctor can approve the summary, which locks it and saves it locally
- Screen matches the wireframe already agreed: patient banner, section navigator, draft panel, edit area, regenerate and approve actions

**Out of scope:**
- Authentication of any kind (the test server has none, and the prototype does not need to simulate it)
- Writing the approved summary back to Sansys's system, or any endpoint that mutates their data
- Handling real PHI or production data
- Offline support, retry queues, or resilience beyond a basic error message when an API call fails
- Supporting every specialty Sansys eventually wants, three is enough to prove the config driven approach works
- Mobile or tablet layouts

## 6. System architecture

Three parts, talking to each other over plain HTTP:

```
[Browser: doctor's screen]
        |
        v
[Prototype backend]  --->  [Sansys test API]   (read only, no auth)
        |
        v
[LLM provider]  (Claude / OpenAI / other, behind one interface)
        |
        v
[Local storage]  (approved summaries only, never sent anywhere else)
```

Suggested stack: Python with Flask for the backend, matching the existing skill set this will be built with. SQLite for local storage, no need for Postgres or Docker for a demo of this size, though either can be added later if it helps the prototype look closer to Sansys's own stack.

Frontend: server rendered templates are enough to hit the MVP scope and are faster to build. Move to a small React frontend only if per-section regenerate without a full page reload turns out to matter for the demo.

## 7. Data source: Sansys test API reference

Base URL: `http://182.70.249.137:3030`

No authentication on any endpoint. Full URL is always base + the module's route + the specific path, for example the clinical notes list is `http://182.70.249.137:3030/clinical-notes/list`.

Patient identifiers are inconsistent across endpoints and this is the first thing the data access layer needs to handle: some endpoints take `dfn` (e.g. `PAT123456`), others take `patientIen`. Visit and admission identifiers are also inconsistent: `visit_id`, `admissionIen`, and `admissionId` all appear, sometimes formatted like `1-1` or `2-4`. Do not assume these are interchangeable without checking the specific endpoint's sample response.

| # | Data | Method | Full URL | Request body / params | Key response fields for this feature |
|---|------|--------|----------|------------------------|----------------------------------------|
| 1 | Patient demographics | GET | `/patientHome/load-demographics/:dfn?userId=1` | path param `dfn` | `lfname`, `llname`, `lsex`, `dob`, `lage`, `cpPID` (UHID), `ward`, `admdt`, `pphy` (primary physician), `DisDate` (empty until discharge is finalized), `cpIPNo` |
| 2 | Clinical notes list | POST | `/clinical-notes/list` | `patient_dfn`, `duz`, `limit`, `offset`, `date_from`, `date_to`, `search_text`, `status_filter` | `note_title`, `date_of_entry`, `status_name`, `author_name` |
| 3 | Clinical note detail | GET | `/clinical-notes/view/:note_ien` | path param `note_ien` | `content` (often empty in test data), `patient_objects` (vitals/allergies/etc references, often empty) |
| 4 | Lab orders | POST | `/lab/list` | `dfn`, `status`, `visit_id`, `from_date`, `to_date` | `orders[]`: `itemOrdered`, `section`, `orderDateTime`, `status.name` |
| 5 | Radiology orders | POST | `/rad/cpoe-list` | `dfn`, `status`, `visit_id`, `from_date`, `to_date` | `orders[]`: `imaging_procedure`, `imaging_type`, `status`, `start_date_time` |
| 6 | Vitals | GET | `/vitals/dash/load/:dfn?fromDate=&toDate=&admissionId=&range=1` | path param `dfn`, query params as shown | `vitals[]`: `date_time`, `measurements` (blood pressure, temperature, pulse oximetry, each with `value` and `is_abnormal`) |
| 7 | Problem list | POST | `/problems/dash-list` | `dfn`, `status`, `visit_id` | `problems[]`: `problem`, `status`, `dateOnset`, `comorbidity` |
| 8 | Diagnosis | POST | `/diagnosis/dash/list` | `dfn`, `visit_id`, `duz` | `diagnoses[]`: `type` (Primary/Secondary), `diagnosis`, `isPrimary`, `dateEntered` |
| 9 | Chief complaints | GET | `/chiefcomplaint/dash-list/:patientIen?status=1&admissionIen=1` | path param `patientIen`, query params as shown | `complaints[]`: `complaint_name`, `complaint_type` (Chief Complaint / Associated Complaint), `remark`, `date` |
| 10 | Allergies | GET | `/allergies/dashboard-list/:patientIen` | path param `patientIen` | `data[]`: `allergy`, `natureOfReaction`, `symptoms`, `date`; top level `status` (e.g. NKA) |
| 11 | Medications | POST | `/med/list?dfn=PAT123456` | `dfn`, `status`, `schedule_type`, `visit_id`, `from_date`, `to_date` | `orders[]`: `medication_name`, `start_date`, `stop_date`, `status`, `schedule_type` |

Build one data access module that wraps all eleven calls and returns a single normalized patient data object. Every other part of the app (specialty configs, prompts, UI) reads from that normalized object, never from raw API responses directly. If a field name changes later, only this module needs updating.

There is no mock fallback: if an endpoint is unreachable, times out, or returns a non-2xx status, the whole patient fetch fails with a clear error and the UI surfaces it. Nothing is fabricated. The sample responses in this document are the reference for the live shapes and are mirrored in the test fixture (`server/test/fixtures/patient.js`).

## 8. Specialty configuration system

A specialty template is a config object (a JSON file per specialty is enough for a prototype) listing, in order, the sections that appear in that specialty's discharge summary, and where each section's content comes from.

### Section to data source mapping

This is the real state of what the test API can and cannot support. Several sections have no structured source at all, this is worth being upfront about rather than pretending the LLM can fill them in reliably.

| Section | Source | Notes |
|---|---|---|
| Date and Time of Discharge | Doctor enters manually when starting the draft | `DisDate` in demographics is empty until the hospital actually finalizes discharge, so it cannot be pulled automatically |
| Diagnosis | Diagnosis endpoint, primary shown first, then secondary | |
| Presenting Complaints | Chief complaints endpoint, filtered to `complaint_type == "Chief Complaint"` | |
| History of Present Illness | Chief complaints endpoint, `complaint_type == "Associated Complaint"` plus the `remark` field, woven into a narrative by the LLM | There is no dedicated HPI field in the API, this is a reasonable proxy, not a confirmed one, and should be reviewed |
| Past Medical History | Problem list endpoint | Distinguishing a genuinely past condition from the condition that caused this admission is not clean in the data. Treat every problem not obviously tied to the current diagnosis as past history, and flag this logic for review |
| Current Medication | Medication endpoint, orders with `status == "ACTIVE"` | The API does not clearly separate home medications from medications started during this admission, treat as best effort |
| Personal History | No source in the API | Leave blank for the doctor to fill in, do not ask the LLM to invent this |
| Family History | No source in the API | Same as above |
| Allergies | Allergies endpoint | Also worth surfacing in the patient banner as a visible flag, not just buried in a section |
| Occupational History | No source in the API | Leave blank for the doctor |
| On Examination | Vitals endpoint, most recent reading | This only covers vitals, not a physical exam. The generated text should say so rather than implying a fuller exam happened |
| Course in Hospital | Composed by the LLM from lab orders, radiology orders, medication changes, and the vitals trend across the stay | This is the section that needs the most synthesis across sources, and the one most worth a doctor's close review before approval |
| Condition at Discharge | Most recent vitals, plus current status of active problems | |
| Procedure | No source in the API at all | This matters most for CTVS, a surgical specialty, and there is no procedures or OT record endpoint provided. For the prototype this has to be a required manual field, the draft generator should not attempt to write it |
| Medications During Stay | Medication endpoint, all orders with a `start_date` inside the admission window | |
| Medications on Discharge | Medication endpoint, orders with `status == "ACTIVE"` at the time the draft is generated | |
| Advice | No structured source | LLM can draft something generic from the diagnosis, but this should be flagged as needing doctor input, not treated as reliable |
| Special Needs | No source in the API | Leave blank for the doctor |
| Follow Up Advice | No structured source | Same treatment as Advice |

### Seed configs for the three specialties

- **General**: the full section list above. This is also the fallback template when no specialty specific config exists for a patient.
- **Dermatology**: same as General, but drop Procedure entirely, since it is rarely relevant and has no source anyway. Bias the On Examination and Course in Hospital prompt hints toward skin findings.
- **CTVS**: same as General, but keep Procedure and mark it as a required manual field, the approve action should not be allowed to complete if it is empty. Bias Course in Hospital toward surgical and post operative detail.

These three configs are a reasonable starting point for the prototype, not something confirmed with Sansys's clinical team. Worth a check before treating the specialty differences as final, since the real difference between how Dermatology and CTVS summaries should read is a clinical judgment, not something inferable from the API alone.

## 9. LLM generation layer

Build a small interface so the app is not locked to one LLM vendor:

```
generate_draft(patient_data, specialty_config) -> { section_id: text, ... }
regenerate_section(section_id, patient_data, specialty_config, existing_draft) -> text
```

Behind this interface, one adapter per provider (Claude, OpenAI, others later), selected at runtime by an environment variable such as `LLM_PROVIDER=anthropic`. Every adapter takes the same input shape and returns the same output shape, so switching providers is a config change, not a code change. API keys come from environment variables only, never hardcoded, never logged.

Generation approach:
- One call generates the full draft, requesting structured output (JSON keyed by section id) so it can be dropped straight into the UI without extra parsing logic.
- A second, smaller call handles single section regeneration, passing that section's prompt hint plus the already generated sections as context, so regenerating one section does not reset the doctor's edits elsewhere.
- For sections with no data source (see the table above), the generator should either skip generating that section entirely and leave it empty for manual entry, or, if attempted, explicitly state that no supporting data was found rather than inventing plausible sounding content. Fabricated clinical detail is the single biggest risk in this feature, and it matters more than getting the exact prompt wording right.

## 10. Backend design

Suggested internal endpoints:

- `GET /patients/:dfn` — normalized patient data pulled from the eleven Sansys endpoints
- `POST /patients/:dfn/draft` — generate a full first draft, given a specialty key
- `POST /patients/:dfn/draft/:section_id/regenerate` — regenerate one section
- `POST /patients/:dfn/summary/approve` — save the doctor's final, edited version locally
- `GET /patients/:dfn/summary` — retrieve a previously approved summary, if one exists for this patient

Local storage schema, roughly:

```
summaries
  id
  patient_dfn
  specialty
  sections (json: section_id -> final text)
  approved_at
  approved_by (free text is fine for a prototype, no real auth)
```

## 11. UI feel

This needs to look like it belongs inside the existing IPD module, not like a separate AI product. Match the density and structure of Sansys's own screens rather than a spacious consumer app.

**Overall style**: enterprise EHR density, similar to what is visible in the existing Global VistA screens (Epic/Cerner-like). Compact rows, clear field labels, minimal whitespace, no illustrations or decorative elements. Grayscale or muted color is fine for the prototype, it does not need a full visual design pass, function over polish.

**Layout**:
- A thin patient banner across the top: name, UHID, age/sex, ward, admitting doctor, and a visible allergy flag if any are on record. This should read exactly like the existing demographic strip already used in Sansys's screens.
- A left hand vertical list of the current specialty's sections, acting as a jump menu. The active section is visually distinct (border or shading), matching the pattern already used in their Clinical Template Builder screens.
- A center panel showing the AI generated draft text for the selected section, clearly labeled as AI generated, not blended in with doctor authored text.
- A Regenerate control near the top of that panel, scoped to the currently selected section.
- A separate, visually distinct edit area below or beside the draft, where the doctor's own edits live. The distinction between "what the AI wrote" and "what the doctor changed" should be visible at every point before approval, not just in the data model.
- An Approve action, disabled until any specialty-required manual fields (like Procedure for CTVS) are filled in.
- Sections with no data source should show a clear, plain state like "No data available, enter manually" rather than a blank box that looks broken or a spinner that never resolves.

**Interaction flow**: page loads, patient data fetches, the full first draft generates automatically without the doctor needing to click anything. The doctor reads through sections, edits inline where needed, regenerates individual sections if the draft missed something, and clicks Approve when satisfied. Once approved, the summary becomes read only for that session, since there is no write-back and nothing further to do with it in the prototype.

**Loading and error states**: while data is fetching or a draft is generating, show a simple inline loading indicator per panel, not a full page blocker. If a Sansys endpoint fails, show a plain message on that specific section rather than failing the whole screen, since one endpoint being down should not block review of everything else.

## 12. Acceptance criteria for the demo

- Given a real patient `dfn` from the test server, the screen loads that patient's demographics, complaints, diagnosis, problems, allergies, medications, labs, radiology, and vitals without manual data entry.
- A first draft is generated automatically covering every section defined for that patient's specialty.
- Switching specialty configs (Dermatology vs CTVS vs General) visibly changes which sections appear, without any code change, just a different config file.
- The doctor can edit any section's text and the edit persists in the UI.
- The doctor can regenerate one section without losing edits made to other sections.
- CTVS demo cannot be approved with an empty Procedure field.
- Approving saves the summary locally and it can be retrieved again via `GET /patients/:dfn/summary`.
- No call is ever made back to any Sansys endpoint that writes or modifies data.
- Switching the `LLM_PROVIDER` environment variable changes which LLM generates the draft, without touching application code.

## 13. Explicitly out of scope

- Authentication
- Any write-back to Sansys's system
- Production or real patient data
- Offline handling beyond a basic per-section error message
- Specialties beyond Dermatology, CTVS, and General
- Mobile layouts

## 14. Open items to confirm before this goes further

- Whether the section-to-data mapping in section 8 matches what Sansys's clinical team actually wants, particularly the Past Medical History logic and the Course in Hospital synthesis, both of which involve judgment calls the API data alone cannot resolve.
- Whether Procedure really has no data source anywhere in their system, or whether there is a procedures/OT endpoint that simply was not included in the documentation handed over.
- Which LLM provider should be the default for the demo. The interface supports any, but one has to be the default in the environment config.

## 15. Suggested build order

1. Data access layer against the eleven real endpoints (no mock fallback — endpoint failures fail the fetch and surface in the UI).
2. Normalization layer that resolves the `dfn` vs `patientIen` and visit identifier inconsistencies into one clean patient object.
3. Specialty config schema, plus the three seed configs from section 8.
4. LLM provider abstraction and the generation/regeneration prompts, with explicit "no data, do not invent" handling for sourceless sections.
5. Backend endpoints: fetch, draft, regenerate, approve, retrieve.
6. Frontend screen matching section 11.
7. Local storage for approved summaries.
8. End to end run against a real patient `dfn` from the test server, once for each of the three specialties.

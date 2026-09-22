# Shared contracts — read before touching anything else

These shapes are frozen. Every module (dataAccess, llm/*, routes, client) reads
and writes exactly these shapes. If a Sansys field name changes, only
dataAccess.js changes (its external reference is `sansys-api.md`).

## Normalized patient object (`GET /patients/:dfn` response)

```jsonc
{
  "dfn": "PAT123456",
  "demographics": {
    "firstName": "", "lastName": "", "sex": "", "dob": "", "age": "",
    "uhid": "",        // cpPID
    "ipNo": "",        // cpIPNo
    "ward": "", "admitDate": "", "primaryPhysician": "", "dischargeDate": ""
  },
  "complaints":    [{ "name": "", "type": "Chief Complaint" | "Associated Complaint", "remark": "", "date": "" }],
  "diagnoses":     [{ "diagnosis": "", "isPrimary": true, "type": "", "dateEntered": "" }],  // primary first
  "problems":      [{ "problem": "", "status": "", "dateOnset": "", "comorbidity": false }],
  "allergies":     { "status": "", "items": [{ "allergy": "", "reaction": "", "symptoms": "", "date": "" }] },
  "medications":   [{ "medication": "", "startDate": "", "stopDate": "", "status": "", "schedule": "", "scheduleType": "", "route": "", "service": "", "provenance": [] }],
  "activeMedications": [{ "medication": "", "startDate": "", "stopDate": "", "status": "", "schedule": "", "scheduleType": "", "route": "", "service": "", "provenance": [] }],
  "dischargeMedications": [{ "medication": "", "startDate": "", "stopDate": "", "status": "", "schedule": "", "scheduleType": "", "route": "", "service": "", "provenance": [] }],
  "labOrders":     [{ "name": "", "section": "", "orderDateTime": "", "status": "" }],
  "radOrders":     [{ "procedure": "", "imagingType": "", "status": "", "dateTime": "" }],
  "vitals":        [{ "dateTime": "", "measurements": [{ "name": "", "value": "", "isAbnormal": false }] }], // newest last
  "notes":         [{ "noteIen": "", "title": "", "dateOfEntry": "", "status": "", "author": "", "content": [], "patientObjects": {}, "provenance": [] }],
  "episodes":      [{ "id": "1-9013", "label": "23 JUL 2026 16:11 - MAX-SMART ICU-A", "admissionId": "9013", "startDate": "2026-07-23", "dateFrom": "2026-07-23", "dateTo": "" }],
  "episodeId":     "1-9013"
}
```

Every normalized clinical fact carries a `provenance` array. Endpoint facts
identify the Sansys endpoint, response path, and episode. Clinical-note facts
identify the note IEN, title/date, and the `patient_objects` or content path.
Facts that exist only in a clinical note also carry `needsVerification: true`;
facts confirmed by an episode endpoint are not marked provisional.

## Specialty config (`src/specialties/*.json`)

```jsonc
{
  "key": "general" | "dermatology" | "ctvs",
  "label": "General",
  "fallback": true,          // only general.json
  "sections": [
    {
      "id": "diagnosis",              // kebab/camel stable id
      "title": "Diagnosis",
      "source": "diagnoses" | "complaints" | ... | null,   // key into normalized object, null = no data source
      "sources": ["notes", "labOrders"], // optional multiple normalized sources for one section
      "promptHint": "...",            // biasing text for the LLM (skin findings, surgical detail, ...)
      "requiredManual": false,        // true => approve blocked while final text empty (Procedure in CTVS)
      "manualEntry": false            // true => never sent to LLM, left for doctor (Procedure everywhere)
    }
  ]
}
```

Section order in the array = order in the UI. `general.json` is the fallback
when a patient's specialty has no config.

## LLM provider interface (`src/llm/*`)

- `generateDraft(patientData, specialtyConfig)` → `{ sections: { [sectionId]: string }, extractedFacts, provider: string }`.
  Sections with `source: null` are returned as `""` (never sent to the model).
- `regenerateSection(sectionId, patientData, specialtyConfig, existingDraft)` → `{ text: string, extractedFacts, provider: string }`.
- Providers are selected by `LLM_PROVIDER` (`config.js`): `anthropic`
  (`anthropic.js`, native Messages API) and the OpenAI-compatible presets
  `openai`, `google`, `groq`, `ollama` (`chat.js` + presets in `config.js`;
  any custom endpoint works via `LLM_BASE_URL`). Real providers require their
  API key from env unless the preset allows keyless (Ollama); without a key the
  call fails with a clear error. There is no fallback provider.
- Tests inject a stub provider via `registerProvider(name, adapter)` in
  `llm/index.js` (test-only hook, never used at runtime).

## REST API (all JSON)

- `GET  /api/patients/:dfn?episodeId=1-9013` → normalized patient object for the selected IP episode, including `episodes` and `episodeId`
- `GET  /api/patients/:dfn/shell?episodeId=1-9013` → fast shell with demographics, allergies, `episodes`, and `episodeId`; clinical collections are empty until the full patient request completes
- `GET  /api/specialties` → `{ specialties: [{ key, label, sectionCount }] }`
- `POST /api/patients/:dfn/draft` body `{ specialty, episodeId, sectionIds }` → `{ specialty, sections: { id: text }, sourceData, sourceDataBeforeReconciliation, provider }`. `sourceData` is the reconciled source snapshot used for the final draft; `sourceDataBeforeReconciliation` records the snapshot supplied before model-extracted note facts were merged.
- `POST /api/patients/:dfn/draft/:sectionId/regenerate` body `{ specialty, episodeId, currentDraft }` → `{ text, sourceData, sourceDataBeforeReconciliation, provider }`
- `POST /api/patients/:dfn/summary/approve` body `{ specialty, episodeId, sections, approvedBy }`
  → `400 { error }` if any `requiredManual` section is empty; else `{ ok: true, approvedAt }`
- `GET  /api/patients/:dfn/summary?episodeId=1-9013` → `{ summary: null }` or
  `{ summary: { patientDfn, episodeId, specialty, sections, approvedAt, approvedBy } }`

Express also serves the built React client from `server/public/` at `/`.

## Storage (store.js, better-sqlite3)

Table `summaries`: `id INTEGER PK, patient_dfn TEXT, episode_id TEXT,
specialty TEXT, sections TEXT (JSON), approved_at TEXT, approved_by TEXT`. One
row per patient/episode pair (upsert on approve).

Patient data is cached in process for 60 seconds only to prevent the draft and
regeneration routes from refetching the same Sansys data. It is not persistent
clinical storage; a process restart clears it. Clinical-note details are
deferred from the patient endpoint and loaded when draft generation needs them.
Structured objects in clinical notes are reconciled into the same normalized
fact collections as endpoint data. Note-only medication facts are retained
with note provenance and marked for doctor verification; they are never
silently treated as confirmed orders.

## Hard rules

1. Never call any Sansys endpoint that writes/mutates data. Only the 11 documented reads.
2. API keys from env only; never log them.
3. The LLM must never invent content for sourceless sections — empty or an
   explicit "no supporting data found" note, per brief §9.
